#!/usr/bin/env node
/**
 * sb3git — Scratch (.sb3) 用 Git ライクなバージョン管理ツール
 *
 * コマンド一覧:
 *   init <file>            リポジトリを初期化
 *   status                 作業ファイルの変更状態を表示
 *   commit -m <msg>        現在の .sb3 をコミット
 *   log [-n <n>]           コミット履歴を表示
 *   diff [ref1] [ref2]     ブロック差分を scratchblocks 形式で表示
 *   show <ref>             コミットの詳細を表示
 *   checkout <ref>         指定コミット/ブランチに .sb3 を復元
 *   branch [name]          ブランチ作成 or 一覧
 *   branch -d <name>       ブランチ削除
 *   switch <branch>        ブランチを切り替え
 *   track <file>           追跡ファイルを変更
 */

import { program }             from 'commander';
import chalk                   from 'chalk';
import path                    from 'path';
import { existsSync }          from 'fs';
import { writeFile }           from 'fs/promises';
import { readSb3, writeSb3 }   from './sb3.js';
import { Repo, GIT_DIR }       from './repo.js';
import { diffProjects, formatDiff } from './diff.js';

// ------------------------------------------------------------------ //
// ユーティリティ
// ------------------------------------------------------------------ //

const repo = new Repo();

function assertInit() {
  if (!repo.isInitialized()) {
    console.error(chalk.red('エラー: sb3git リポジトリではありません (.sb3git が見つかりません)'));
    process.exit(1);
  }
}

function shortHash(hash) {
  return hash ? hash.slice(0, 7) : '(none)';
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ------------------------------------------------------------------ //
// init
// ------------------------------------------------------------------ //

program
  .command('init <file>')
  .description('指定した .sb3 ファイルのリポジトリを初期化し、初回コミットを作成')
  .option('-m, --message <msg>', '初回コミットのメッセージ', 'initial commit')
  .action(async (file, opts) => {
    if (repo.isInitialized()) {
      console.log(chalk.yellow('すでに初期化済みです。'));
      return;
    }
    if (!existsSync(file)) {
      console.error(chalk.red(`ファイルが見つかりません: ${file}`));
      process.exit(1);
    }

    const { projectJson, assets } = await readSb3(file);
    await repo.init(path.relative(process.cwd(), file));
    const hash = await repo.commit(projectJson, assets, opts.message);

    const spriteCnt = (projectJson.targets ?? []).filter(t => !t.isStage).length;
    console.log(chalk.green(`✓ 初期化完了: ${file}`));
    console.log(chalk.gray(`  スプライト数: ${spriteCnt}  |  アセット数: ${Object.keys(assets).length}`));
    console.log(chalk.gray(`  初回コミット: ${shortHash(hash)}  ("${opts.message}")`));
  });

// ------------------------------------------------------------------ //
// status
// ------------------------------------------------------------------ //

program
  .command('status')
  .description('作業ファイルと最新コミットの差分状態を表示')
  .option('-l, --locale <locale>', 'ロケール', 'en')
  .action(async (opts) => {
    assertInit();
    const config      = await repo.getConfig();
    const currentHash = await repo.getCurrentCommitHash();
    const head        = await repo.getHead();

    // HEAD 表示
    if (head.type === 'branch') {
      console.log(chalk.bold(`On branch ${head.branch}`));
    } else {
      console.log(chalk.bold(`HEAD detached at ${shortHash(head.hash)}`));
    }

    if (!currentHash) {
      console.log('コミットがまだありません');
      return;
    }

    const lastCommit = await repo.loadCommit(currentHash);
    console.log(chalk.gray(`最新コミット: ${shortHash(currentHash)}  "${lastCommit.message}"`));
    console.log();

    let currentProject;
    try {
      const { projectJson } = await readSb3(config.trackedFile);
      currentProject = projectJson;
    } catch {
      console.error(chalk.red(`追跡ファイルが読めません: ${config.trackedFile}`));
      process.exit(1);
    }

    const diffs = diffProjects(lastCommit.projectJson, currentProject, opts.locale);

    if (diffs.length === 0) {
      console.log(chalk.green('変更なし (クリーンな作業ツリー)'));
    } else {
      console.log(chalk.yellow('変更あり:'));
      for (const d of diffs) {
        const icon = d.type === 'added' ? chalk.green('+') : d.type === 'removed' ? chalk.red('-') : chalk.yellow('M');
        console.log(`  ${icon}  ${d.name}`);
      }
      console.log();
      console.log(chalk.gray(`"sb3git commit -m <メッセージ>" でコミットできます`));
    }
  });

// ------------------------------------------------------------------ //
// commit
// ------------------------------------------------------------------ //

program
  .command('commit')
  .description('現在の .sb3 ファイルをリポジトリにコミット')
  .requiredOption('-m, --message <msg>', 'コミットメッセージ')
  .option('-a, --author <name>', '作者名', 'sb3git')
  .option('-l, --locale <locale>', 'ロケール', 'en')
  .action(async (opts) => {
    assertInit();
    const config = await repo.getConfig();

    let projectJson, assets;
    try {
      ({ projectJson, assets } = await readSb3(config.trackedFile));
    } catch {
      console.error(chalk.red(`追跡ファイルが読めません: ${config.trackedFile}`));
      process.exit(1);
    }

    // 差分チェック
    const currentHash = await repo.getCurrentCommitHash();
    if (currentHash) {
      const last  = await repo.loadCommit(currentHash);
      const diffs = diffProjects(last.projectJson, projectJson, opts.locale);
      if (diffs.length === 0) {
        console.log(chalk.yellow('コミットするものがありません (クリーンな作業ツリー)'));
        return;
      }
    }

    const hash = await repo.commit(projectJson, assets, opts.message, opts.author);
    console.log(chalk.green(`✓ コミット: ${shortHash(hash)}`));
    console.log(chalk.gray(`  "${opts.message}"  by ${opts.author}`));
  });

// ------------------------------------------------------------------ //
// log
// ------------------------------------------------------------------ //

program
  .command('log')
  .description('コミット履歴を表示')
  .option('-n, --num <n>', '最大表示件数', '10')
  .option('--oneline', '1行形式で表示', false)
  .action(async (opts) => {
    assertInit();
    const limit = parseInt(opts.num, 10);
    const log   = await repo.getLog(limit);

    if (log.length === 0) {
      console.log(chalk.gray('コミットがまだありません'));
      return;
    }

    for (const commit of log) {
      if (opts.oneline) {
        console.log(`${chalk.yellow(shortHash(commit.hash))}  ${commit.message}`);
      } else {
        console.log(chalk.yellow(`commit ${commit.hash}`));
        console.log(`Author: ${commit.author}`);
        console.log(`Date:   ${formatDate(commit.timestamp)}`);
        console.log(`\n    ${commit.message}\n`);
      }
    }
  });

// ------------------------------------------------------------------ //
// diff
// ------------------------------------------------------------------ //

program
  .command('diff [ref1] [ref2]')
  .description([
    'ブロック差分を scratchblocks 形式で表示',
    '  引数なし    : 作業ファイル vs HEAD',
    '  ref1 のみ   : ref1 vs HEAD',
    '  ref1 ref2   : ref1 vs ref2',
  ].join('\n'))
  .option('-l, --locale <locale>', 'ロケール', 'en')
  .action(async (ref1, ref2, opts) => {
    assertInit();
    const config = await repo.getConfig();

    let oldProject, newProject;

    if (!ref1 && !ref2) {
      // 作業ファイル vs HEAD
      const hash = await repo.getCurrentCommitHash();
      if (!hash) { console.error(chalk.red('コミットがまだありません')); process.exit(1); }
      oldProject = (await repo.loadCommit(hash)).projectJson;
      ({ projectJson: newProject } = await readSb3(config.trackedFile));

    } else if (ref1 && !ref2) {
      // ref1 vs HEAD
      const h1   = await repo.resolveRef(ref1);
      const hCur = await repo.getCurrentCommitHash();
      oldProject = (await repo.loadCommit(h1)).projectJson;
      newProject = (await repo.loadCommit(hCur)).projectJson;

    } else {
      // ref1 vs ref2
      const h1 = await repo.resolveRef(ref1);
      const h2 = await repo.resolveRef(ref2);
      oldProject = (await repo.loadCommit(h1)).projectJson;
      newProject = (await repo.loadCommit(h2)).projectJson;
    }

    const diffs = diffProjects(oldProject, newProject, opts.locale);
    console.log(formatDiff(diffs));
  });

// ------------------------------------------------------------------ //
// show
// ------------------------------------------------------------------ //

program
  .command('show [ref]')
  .description('指定コミット (省略時 HEAD) の詳細とブロック差分を表示')
  .option('-l, --locale <locale>', 'ロケール', 'en')
  .action(async (ref = 'HEAD', opts) => {
    assertInit();

    const hash   = await repo.resolveRef(ref);
    const commit = await repo.loadCommit(hash);

    console.log(chalk.yellow(`commit ${commit.hash}`));
    console.log(`Author: ${commit.author}`);
    console.log(`Date:   ${formatDate(commit.timestamp)}`);
    console.log(`\n    ${commit.message}\n`);

    if (commit.parent) {
      const parent = await repo.loadCommit(commit.parent);
      const diffs  = diffProjects(parent.projectJson, commit.projectJson, opts.locale);
      console.log(formatDiff(diffs));
    } else {
      // 初回コミット: 全スプライトを追加として表示
      const initDiffs = (commit.projectJson.targets ?? [])
        .filter(t => !t.isStage)
        .map(t => ({ name: t.name, type: 'added', blockDiff: null, varChanges: [], costumeChanges: [], soundChanges: [] }));
      console.log(formatDiff(initDiffs));
    }
  });

// ------------------------------------------------------------------ //
// checkout
// ------------------------------------------------------------------ //

program
  .command('checkout <ref>')
  .description('指定コミット/ブランチ に .sb3 を復元')
  .action(async (ref) => {
    assertInit();
    const config = await repo.getConfig();

    // ブランチ優先
    const branches = await repo.listBranches();
    if (branches.includes(ref)) {
      await repo.switchBranch(ref);
      const hash = await repo.getCurrentCommitHash();
      if (hash) {
        const commit = await repo.loadCommit(hash);
        const assets = await repo.getAssetsForCommit(commit);
        await writeSb3(config.trackedFile, commit.projectJson, assets);
      }
      console.log(chalk.green(`✓ ブランチ '${ref}' に切り替えました`));
      return;
    }

    // コミット ref
    const hash   = await repo.resolveRef(ref);
    const commit = await repo.loadCommit(hash);
    const assets = await repo.getAssetsForCommit(commit);
    await writeSb3(config.trackedFile, commit.projectJson, assets);

    // detached HEAD
    await writeFile(repo.headPath, hash);

    console.log(chalk.yellow(`HEAD は ${shortHash(hash)} に切り離されました`));
    console.log(chalk.gray(`  "${commit.message}"  (${formatDate(commit.timestamp)})`));
    console.log(chalk.gray(`  ${config.trackedFile} を復元しました`));
  });

// ------------------------------------------------------------------ //
// branch
// ------------------------------------------------------------------ //

program
  .command('branch [name]')
  .description('ブランチを作成 (name 省略で一覧表示)')
  .option('-d, --delete <name>', '指定ブランチを削除')
  .action(async (name, opts) => {
    assertInit();

    if (opts.delete) {
      const head = await repo.getHead();
      if (head.type === 'branch' && head.branch === opts.delete) {
        console.error(chalk.red(`現在のブランチ '${opts.delete}' は削除できません`));
        process.exit(1);
      }
      await repo.deleteBranch(opts.delete);
      console.log(chalk.green(`✓ ブランチ '${opts.delete}' を削除しました`));
      return;
    }

    if (!name) {
      const branches = await repo.listBranches();
      const head     = await repo.getHead();
      for (const b of branches) {
        const current = head.type === 'branch' && head.branch === b;
        console.log(`${current ? chalk.green('* ') : '  '}${b}`);
      }
    } else {
      await repo.createBranch(name);
      console.log(chalk.green(`✓ ブランチ '${name}' を作成しました`));
    }
  });

// ------------------------------------------------------------------ //
// switch
// ------------------------------------------------------------------ //

program
  .command('switch <branch>')
  .description('ブランチを切り替え (.sb3 も復元)')
  .action(async (branch) => {
    assertInit();
    const config = await repo.getConfig();

    await repo.switchBranch(branch);

    const hash = await repo.getCurrentCommitHash();
    if (hash) {
      const commit = await repo.loadCommit(hash);
      const assets = await repo.getAssetsForCommit(commit);
      await writeSb3(config.trackedFile, commit.projectJson, assets);
      console.log(chalk.gray(`  ${shortHash(hash)}  "${commit.message}" を復元しました`));
    }

    console.log(chalk.green(`✓ ブランチ '${branch}' に切り替えました`));
  });

// ------------------------------------------------------------------ //
// track
// ------------------------------------------------------------------ //

program
  .command('track <file>')
  .description('追跡する .sb3 ファイルのパスを変更')
  .action(async (file) => {
    assertInit();
    if (!existsSync(file)) {
      console.error(chalk.red(`ファイルが見つかりません: ${file}`));
      process.exit(1);
    }
    await repo.setConfig({ trackedFile: path.relative(process.cwd(), file) });
    console.log(chalk.green(`✓ 追跡ファイルを ${file} に変更しました`));
  });

// ------------------------------------------------------------------ //
// parse
// ------------------------------------------------------------------ //

program
  .name('sb3git')
  .description('Scratch (.sb3) 用 Git ライクなバージョン管理ツール')
  .version('0.1.0');

program.parse();
