/**
 * sb3.js — .sb3 ファイルの読み書き
 *
 * .sb3 は ZIP アーカイブで、以下を含む:
 *   - project.json  : スプライト・ブロック・変数等すべての定義
 *   - <md5ext>      : コスチューム・サウンドのバイナリ (MD5+拡張子がファイル名)
 */

import JSZip from 'jszip';
import { readFile, writeFile } from 'fs/promises';

/**
 * .sb3 を読み込み、{ projectJson, assets } を返す
 * @param {string} filePath
 * @returns {{ projectJson: object, assets: Record<string, Buffer> }}
 */
export async function readSb3(filePath) {
  const data = await readFile(filePath);
  const zip = await JSZip.loadAsync(data);

  const projectJson = JSON.parse(
    await zip.file('project.json').async('string')
  );

  const assets = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (name !== 'project.json' && !file.dir) {
      assets[name] = await file.async('nodebuffer');
    }
  }

  return { projectJson, assets };
}

/**
 * projectJson + assets から .sb3 を書き出す
 * @param {string} filePath
 * @param {object} projectJson
 * @param {Record<string, Buffer>} assets
 */
export async function writeSb3(filePath, projectJson, assets) {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(projectJson));

  for (const [name, data] of Object.entries(assets)) {
    zip.file(name, data);
  }

  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  await writeFile(filePath, content);
}
