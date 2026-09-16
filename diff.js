/**
 * diff.js — project.json 間の差分を scratchblocks テキスト形式で生成
 *
 * parse-sb3-blocks の toScratchblocks() でブロックをテキスト化し、
 * diff ライブラリで行単位の差分を計算する。
 */

import { toScratchblocks } from 'parse-sb3-blocks';
import { diffLines } from 'diff';
import chalk from 'chalk';

// ------------------------------------------------------------------ //
// ブロック → scratchblocks テキスト変換
// ------------------------------------------------------------------ //

/**
 * 1スプライト/ステージのブロック群を scratchblocks テキストに変換。
 * トップレベル(帽子ブロック等)ごとにスクリプトを生成し、
 * ソート後に結合して安定した文字列を返す。
 *
 * @param {object} target  project.json の targets[] の1要素
 * @param {string} locale  ロケール ('en' 等)
 * @returns {string}
 */
function targetToText(target, locale = 'en') {
  const { blocks = {} } = target;
  const scripts = [];

  for (const [id, block] of Object.entries(blocks)) {
    if (!block.topLevel) continue;
    // parse-sb3-blocks が未対応 opcode を console.log/error に出力するため一時抑制
    const _log = console.log;
    const _err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      const code = toScratchblocks(id, blocks, locale, { tabs: '  ' });
      scripts.push(code.trimEnd());
    } catch {
      // 解析できないブロックはプレースホルダーで代替
      scripts.push(`// [parse error: ${id}]`);
    } finally {
      console.error = _err;
    }
  }

  // 順序を安定させるためソート
  scripts.sort();
  return scripts.join('\n\n');
}

// ------------------------------------------------------------------ //
// プロジェクト全体の差分
// ------------------------------------------------------------------ //

/**
 * 2つの project.json を比較し、スプライトごとの差分リストを返す。
 *
 * @param {object} oldProject
 * @param {object} newProject
 * @param {string} locale
 * @returns {DiffEntry[]}
 *
 * @typedef {{ name: string, type: 'added'|'removed'|'modified',
 *             blockDiff: import('diff').Change[]|null,
 *             varChanges: NameChange[], costumeChanges: NameChange[], soundChanges: NameChange[] }} DiffEntry
 * @typedef {{ type: 'added'|'removed', name: string }} NameChange
 */
export function diffProjects(oldProject, newProject, locale = 'en') {
  const results = [];

  const oldMap = new Map((oldProject.targets ?? []).map(t => [t.name, t]));
  const newMap = new Map((newProject.targets ?? []).map(t => [t.name, t]));
  const allNames = new Set([...oldMap.keys(), ...newMap.keys()]);

  for (const name of allNames) {
    const oldT = oldMap.get(name);
    const newT = newMap.get(name);

    if (!oldT) { results.push({ name, type: 'added',   blockDiff: null, varChanges: [], costumeChanges: [], soundChanges: [] }); continue; }
    if (!newT) { results.push({ name, type: 'removed',  blockDiff: null, varChanges: [], costumeChanges: [], soundChanges: [] }); continue; }

    const entry = {
      name,
      type: 'unchanged',
      blockDiff:      null,
      varChanges:     [],
      costumeChanges: [],
      soundChanges:   [],
    };

    // ── ブロック差分 ──────────────────────────────────────────────── //
    const oldCode = targetToText(oldT, locale);
    const newCode = targetToText(newT, locale);
    if (oldCode !== newCode) {
      entry.blockDiff = diffLines(oldCode, newCode);
      entry.type = 'modified';
    }

    // ── 変数・リスト差分 ──────────────────────────────────────────── //
    const diffNameSets = (oldRaw, newRaw, label) => {
      const oldNames = new Set(Object.values(oldRaw ?? {}).map(v => v[0]));
      const newNames = new Set(Object.values(newRaw ?? {}).map(v => v[0]));
      const changes = [];
      for (const n of newNames) if (!oldNames.has(n)) changes.push({ type: 'added',   name: label ? `[${label}] ${n}` : n });
      for (const n of oldNames) if (!newNames.has(n)) changes.push({ type: 'removed', name: label ? `[${label}] ${n}` : n });
      return changes;
    };

    entry.varChanges = [
      ...diffNameSets(oldT.variables, newT.variables, ''),
      ...diffNameSets(oldT.lists,     newT.lists,     'リスト'),
    ];

    // ── コスチューム・サウンド差分 ────────────────────────────────── //
    const diffArrayByName = (oldArr, newArr) => {
      const oldNames = new Set((oldArr ?? []).map(x => x.name));
      const newNames = new Set((newArr ?? []).map(x => x.name));
      const changes = [];
      for (const n of newNames) if (!oldNames.has(n)) changes.push({ type: 'added',   name: n });
      for (const n of oldNames) if (!newNames.has(n)) changes.push({ type: 'removed', name: n });
      return changes;
    };

    entry.costumeChanges = diffArrayByName(oldT.costumes, newT.costumes);
    entry.soundChanges   = diffArrayByName(oldT.sounds,   newT.sounds);

    const hasChange =
      entry.type === 'modified' ||
      entry.varChanges.length   > 0 ||
      entry.costumeChanges.length > 0 ||
      entry.soundChanges.length > 0;

    if (hasChange) {
      if (entry.type === 'unchanged') entry.type = 'modified';
      results.push(entry);
    }
  }

  return results;
}

// ------------------------------------------------------------------ //
// 差分の表示フォーマット
// ------------------------------------------------------------------ //

/**
 * diffProjects() の結果を ANSI カラー付き文字列に変換
 * @param {DiffEntry[]} diffResults
 * @returns {string}
 */
export function formatDiff(diffResults) {
  if (diffResults.length === 0) return chalk.green('差分なし');

  const lines = [];

  for (const result of diffResults) {
    if (result.type === 'added') {
      lines.push(chalk.bgGreen.black(` + スプライト追加: ${result.name} `), '');
      continue;
    }
    if (result.type === 'removed') {
      lines.push(chalk.bgRed.white(` - スプライト削除: ${result.name} `), '');
      continue;
    }

    lines.push(chalk.bold.cyan(`\n@@@ ${result.name} @@@`));

    // ブロック差分
    if (result.blockDiff) {
      for (const part of result.blockDiff) {
        const color  = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        const partLines = part.value.split('\n');
        if (partLines.at(-1) === '') partLines.pop();
        for (const ln of partLines) lines.push(color(`${prefix} ${ln}`));
      }
    }

    // 変数・リスト
    if (result.varChanges.length > 0) {
      lines.push(chalk.bold('  ── 変数・リスト ──'));
      for (const ch of result.varChanges) {
        lines.push((ch.type === 'added' ? chalk.green : chalk.red)(
          `  ${ch.type === 'added' ? '+' : '-'} ${ch.name}`
        ));
      }
    }

    // コスチューム
    if (result.costumeChanges.length > 0) {
      lines.push(chalk.bold('  ── コスチューム ──'));
      for (const ch of result.costumeChanges) {
        lines.push((ch.type === 'added' ? chalk.green : chalk.red)(
          `  ${ch.type === 'added' ? '+' : '-'} ${ch.name}`
        ));
      }
    }

    // サウンド
    if (result.soundChanges.length > 0) {
      lines.push(chalk.bold('  ── サウンド ──'));
      for (const ch of result.soundChanges) {
        lines.push((ch.type === 'added' ? chalk.green : chalk.red)(
          `  ${ch.type === 'added' ? '+' : '-'} ${ch.name}`
        ));
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
