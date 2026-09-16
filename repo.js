/**
 * repo.js — .sb3git/ リポジトリの作成・コミット・ブランチ管理
 *
 * .sb3git/ ディレクトリ構造:
 *   HEAD                 現在のブランチ参照 or コミットハッシュ
 *   config.json          追跡ファイルパス等の設定
 *   refs/heads/<branch>  ブランチ先端のコミットハッシュ
 *   commits/<hash>.json  コミットオブジェクト (project.json を内包)
 *   assets/<md5ext>      アセットバイナリ (コンテンツアドレス、重複排除済み)
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync }                           from 'fs';
import path                                     from 'path';
import crypto                                   from 'crypto';

export const GIT_DIR = '.sb3git';

export class Repo {
  constructor(repoPath = process.cwd()) {
    this.repoPath = repoPath;
    this.gitDir   = path.join(repoPath, GIT_DIR);
  }

  // ── パス定義 ───────────────────────────────────────────────────── //

  get commitsDir() { return path.join(this.gitDir, 'commits'); }
  get assetsDir()  { return path.join(this.gitDir, 'assets');  }
  get refsDir()    { return path.join(this.gitDir, 'refs', 'heads'); }
  get headPath()   { return path.join(this.gitDir, 'HEAD'); }
  get configPath() { return path.join(this.gitDir, 'config.json'); }

  // ── 初期化 ─────────────────────────────────────────────────────── //

  async init(trackedFile) {
    await mkdir(this.commitsDir, { recursive: true });
    await mkdir(this.assetsDir,  { recursive: true });
    await mkdir(this.refsDir,    { recursive: true });

    await writeFile(this.headPath,   'ref: refs/heads/main');
    await writeFile(this.configPath, JSON.stringify({ trackedFile }, null, 2));
  }

  isInitialized() {
    return existsSync(this.gitDir);
  }

  // ── 設定 ───────────────────────────────────────────────────────── //

  async getConfig() {
    return JSON.parse(await readFile(this.configPath, 'utf8'));
  }

  async setConfig(updates) {
    const current = await this.getConfig();
    await writeFile(this.configPath, JSON.stringify({ ...current, ...updates }, null, 2));
  }

  // ── HEAD / ブランチ参照 ────────────────────────────────────────── //

  /**
   * HEAD を解析して { type: 'branch'|'detached', branch?, ref?, hash? } を返す
   */
  async getHead() {
    const content = (await readFile(this.headPath, 'utf8')).trim();
    if (content.startsWith('ref: ')) {
      const ref = content.slice(5);
      return { type: 'branch', ref, branch: path.basename(ref) };
    }
    return { type: 'detached', hash: content };
  }

  async getCurrentCommitHash() {
    const head = await this.getHead();
    if (head.type === 'branch') {
      const refFile = path.join(this.gitDir, head.ref);
      if (!existsSync(refFile)) return null;
      return (await readFile(refFile, 'utf8')).trim() || null;
    }
    return head.hash || null;
  }

  async setCurrentCommitHash(hash) {
    const head = await this.getHead();
    if (head.type === 'branch') {
      await writeFile(path.join(this.gitDir, head.ref), hash);
    } else {
      await writeFile(this.headPath, hash);
    }
  }

  // ── コミット ────────────────────────────────────────────────────── //

  /**
   * コミットハッシュを計算 (コンテンツのSHA-1)
   */
  _hashCommit(data) {
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  }

  async saveCommit(hash, obj) {
    await writeFile(
      path.join(this.commitsDir, `${hash}.json`),
      JSON.stringify(obj, null, 2)
    );
  }

  async loadCommit(hash) {
    const full = await this._resolveHashFull(hash);
    return JSON.parse(await readFile(path.join(this.commitsDir, `${full}.json`), 'utf8'));
  }

  /**
   * アセットを保存 (すでに存在する場合はスキップ = 重複排除)
   */
  async saveAsset(name, data) {
    const dest = path.join(this.assetsDir, name);
    if (!existsSync(dest)) await writeFile(dest, data);
  }

  async loadAsset(name) {
    return readFile(path.join(this.assetsDir, name));
  }

  /**
   * コミットを作成してハッシュを返す
   * @param {object} projectJson
   * @param {Record<string, Buffer>} assets
   * @param {string} message
   * @param {string} [author]
   * @returns {Promise<string>} コミットハッシュ
   */
  async commit(projectJson, assets, message, author = 'sb3git') {
    const parentHash = await this.getCurrentCommitHash();

    // アセット保存 (重複排除)
    for (const [name, data] of Object.entries(assets)) {
      await this.saveAsset(name, data);
    }

    const commitData = {
      parent:     parentHash,
      message,
      author,
      timestamp:  new Date().toISOString(),
      projectJson,
      assetNames: Object.keys(assets),
    };

    const hash = this._hashCommit(commitData);
    await this.saveCommit(hash, { hash, ...commitData });
    await this.setCurrentCommitHash(hash);

    return hash;
  }

  // ── ログ ────────────────────────────────────────────────────────── //

  async getLog(limit = Infinity) {
    const log = [];
    let hash = await this.getCurrentCommitHash();

    while (hash && log.length < limit) {
      const commit = await this.loadCommit(hash);
      log.push(commit);
      hash = commit.parent;
    }

    return log;
  }

  // ── ブランチ ────────────────────────────────────────────────────── //

  async listBranches() {
    try {
      return await readdir(this.refsDir);
    } catch {
      return [];
    }
  }

  async createBranch(name, hash = null) {
    if (!hash) hash = await this.getCurrentCommitHash();
    await writeFile(path.join(this.refsDir, name), hash ?? '');
  }

  async switchBranch(name) {
    const refFile = path.join(this.refsDir, name);
    if (!existsSync(refFile)) throw new Error(`ブランチ '${name}' が見つかりません`);
    await writeFile(this.headPath, `ref: refs/heads/${name}`);
  }

  async deleteBranch(name) {
    const refFile = path.join(this.refsDir, name);
    if (!existsSync(refFile)) throw new Error(`ブランチ '${name}' が見つかりません`);
    const { unlink } = await import('fs/promises');
    await unlink(refFile);
  }

  // ── アセット復元 ─────────────────────────────────────────────────── //

  async getAssetsForCommit(commit) {
    const assets = {};
    for (const name of commit.assetNames ?? []) {
      try {
        assets[name] = await this.loadAsset(name);
      } catch {
        // アセットが見つからない場合は空バッファ
        assets[name] = Buffer.alloc(0);
      }
    }
    return assets;
  }

  // ── ref 解決 ────────────────────────────────────────────────────── //

  /**
   * 短縮ハッシュ (7文字) を完全ハッシュに解決する
   * @param {string} shortHash
   * @returns {Promise<string>}
   */
  async _resolveHashFull(shortHash) {
    if (shortHash.length === 40) return shortHash;
    const files = await readdir(this.commitsDir);
    const match = files.filter(f => f.startsWith(shortHash));
    if (match.length === 0) throw new Error(`コミット '${shortHash}' が見つかりません`);
    if (match.length > 1)   throw new Error(`短縮ハッシュが曖昧です: ${shortHash}`);
    return match[0].replace(/\.json$/, '');
  }

  /**
   * ref 文字列 (HEAD, HEAD~n, ブランチ名, ハッシュ) を解決してコミットハッシュを返す
   * @param {string} ref
   * @returns {Promise<string>}
   */
  async resolveRef(ref) {
    // HEAD
    if (ref === 'HEAD') return this.getCurrentCommitHash();

    // HEAD~n
    const relMatch = ref.match(/^HEAD~(\d+)$/);
    if (relMatch) {
      const n = parseInt(relMatch[1], 10);
      let hash = await this.getCurrentCommitHash();
      for (let i = 0; i < n; i++) {
        const c = await this.loadCommit(hash);
        if (!c.parent) throw new Error(`HEAD~${n} は存在しません (コミット数が足りません)`);
        hash = c.parent;
      }
      return hash;
    }

    // ブランチ名
    const branches = await this.listBranches();
    if (branches.includes(ref)) {
      const refFile = path.join(this.refsDir, ref);
      return (await readFile(refFile, 'utf8')).trim();
    }

    // ハッシュ (短縮含む)
    return this._resolveHashFull(ref);
  }
}
