/**
 * diff.js — project.json 間の差分を scratchblocks SVG で生成
 *
 * parse-sb3-blocks の toScratchblocks() でブロックをテキスト化し、
 * scratchblocks ライブラリで SVG レンダリングを行う。
 */

import { toScratchblocks } from 'parse-sb3-blocks';
import { diffLines } from 'diff';
import chalk from 'chalk';
import scratchblocksInit from 'scratchblocks/index.js';
import { JSDOM } from 'jsdom';

// ------------------------------------------------------------------ //
// ブロック → scratchblocks テキスト変換
// ------------------------------------------------------------------ //

/**
 * 1 スプライト/ステージのブロック群を scratchblocks テキストに変換。
 * トップレベル (帽子ブロック等) ごとにスクリプトを生成し、
 * ソート後に結合して安定した文字列を返す。
 *
 * @param {object} target  project.json の targets[] の 1 要素
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
      console.log = _log;
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
 * 2 つの project.json を比較し、スプライトごとの差分リストを返す。
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
// 差分の表示フォーマット (SVG + HTML)
// ------------------------------------------------------------------ //

/**
 * diffProjects() の結果を SVG 付き HTML 文字列に変換
 * @param {DiffEntry[]} diffResults
 * @returns {string} HTML 全文書
 */
export function formatDiffSvg(diffResults) {
  if (diffResults.length === 0) {
    return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>sb3git diff</title></head>
<body><h1>sb3git diff</h1><p>差分なし</p></body>
</html>`;
  }

  // JSDOM を使ってサーバーサイドで SVG レンダリング
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
  const sb = scratchblocksInit(dom.window);

  const spriteSections = diffResults.map(result => {
    let content = '';
    
    if (result.type === 'added') {
      content = `<h2 class="sprite-added">＋ ${escapeHtml(result.name)}</h2><p>スプライトが追加されました</p>`;
    } else if (result.type === 'removed') {
      content = `<h2 class="sprite-removed">－ ${escapeHtml(result.name)}</h2><p>スプライトが削除されました</p>`;
    } else {
      content = `<h2 class="sprite-modified">${escapeHtml(result.name)}</h2>`;
      
      // ブロック差分
      if (result.blockDiff) {
        const oldBlocks = [];
        const newBlocks = [];
        
        for (const part of result.blockDiff) {
          const lines = part.value.split('\n').filter(l => l.trim());
          if (part.removed) {
            oldBlocks.push(...lines);
          } else if (part.added) {
            newBlocks.push(...lines);
          }
        }
        
        if (oldBlocks.length > 0 || newBlocks.length > 0) {
          content += '<div class="diff-section"><h3>ブロック差分</h3>';
          content += '<div class="diff-row">';
          content += `<div class="diff-old">${renderBlocksSvgInline(oldBlocks, sb)}</div>`;
          content += `<div class="diff-new">${renderBlocksSvgInline(newBlocks, sb)}</div>`;
          content += '</div></div>';
        }
      }
      
      // 変数・リスト
      if (result.varChanges.length > 0) {
        content += '<div class="diff-section"><h3>変数・リスト</h3><ul>';
        for (const ch of result.varChanges) {
          const icon = ch.type === 'added' ? '+' : '-';
          const cls = ch.type === 'added' ? 'var-added' : 'var-removed';
          content += `<li class="${cls}">${icon} ${escapeHtml(ch.name)}</li>`;
        }
        content += '</ul></div>';
      }
      
      // コスチューム
      if (result.costumeChanges.length > 0) {
        content += '<div class="diff-section"><h3>コスチューム</h3><ul>';
        for (const ch of result.costumeChanges) {
          const icon = ch.type === 'added' ? '+' : '-';
          const cls = ch.type === 'added' ? 'costume-added' : 'costume-removed';
          content += `<li class="${cls}">${icon} ${escapeHtml(ch.name)}</li>`;
        }
        content += '</ul></div>';
      }
      
      // サウンド
      if (result.soundChanges.length > 0) {
        content += '<div class="diff-section"><h3>サウンド</h3><ul>';
        for (const ch of result.soundChanges) {
          const icon = ch.type === 'added' ? '+' : '-';
          const cls = ch.type === 'added' ? 'sound-added' : 'sound-removed';
          content += `<li class="${cls}">${icon} ${escapeHtml(ch.name)}</li>`;
        }
        content += '</ul></div>';
      }
    }
    
    return content;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>sb3git diff - ${new Date().toISOString()}</title>
  <style>
    body { font-family: sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
    h1 { color: #4a6da7; border-bottom: 2px solid #4a6da7; padding-bottom: 10px; }
    h2 { margin-top: 30px; padding: 10px; border-radius: 5px; }
    .sprite-added { background: #d4edda; color: #155724; }
    .sprite-removed { background: #f8d7da; color: #721c24; }
    .sprite-modified { background: #fff3cd; color: #856404; }
    .diff-section { margin: 15px 0; padding: 15px; background: white; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .diff-section h3 { margin-top: 0; color: #333; font-size: 1em; }
    .diff-row { display: flex; gap: 20px; }
    .diff-old, .diff-new { flex: 1; min-width: 0; }
    .diff-old { background: #ffeef0; padding: 10px; border-radius: 5px; }
    .diff-new { background: #e6ffed; padding: 10px; border-radius: 5px; }
    .diff-old svg, .diff-new svg { max-width: 100%; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { padding: 3px 0; }
    .var-added, .costume-added, .sound-added { color: #28a745; }
    .var-removed, .costume-removed, .sound-removed { color: #dc3545; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>🔍 sb3git diff</h1>
  <p><small>Generated: ${new Date().toLocaleString('ja-JP')}</small></p>
  <div class="diff-results">${spriteSections}</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBlocksSvgInline(lines, sb) {
  if (lines.length === 0) return '<p><small>（変更なし）</small></p>';
  const code = lines.join('\n');
  
  try {
    const doc = sb.parse(code);
    const svg = sb.render(doc, { style: 'scratch3', scale: 1 });
    const svgString = svg.outerHTML;
    return svgString;
  } catch (e) {
    return `<pre class="blocks">${escapeHtml(code)}</pre>`;
  }
}

// ------------------------------------------------------------------ //
// 旧来のテキストフォーマット（後方互換性のため残す）
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
      lines.push(chalk.bgGreen.black(` + スプライト追加：${result.name} `), '');
      continue;
    }
    if (result.type === 'removed') {
      lines.push(chalk.bgRed.white(` - スプライト削除：${result.name} `), '');
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
