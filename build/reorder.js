/* 词频提取：给四六级词表里的每个词标一个"多常用"的排名
 *
 * 数据源：Google Web Trillion Word Corpus（Peter Norvig 整理的 count_1w.txt）
 * 227,031 条，按出现次数从高到低排。四六级词表覆盖率实测 99.58% / 99.82%。
 *
 * 产出 src/word-freq.json：{ "abandon": 3987, ... }，数字是排名，越小越常用。
 * 只收录词表里真出现的词，文件约 100KB，随代码一起提交。
 *
 * 为什么排名而不是原始次数：原始次数是万亿级大数，排名更小更好读，
 * 而且我们只需要"谁比谁常用"这个相对关系，绝对次数没用。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'freq', 'count_1w.txt');
const OUT = path.join(__dirname, '..', 'src', 'word-freq.json');
const DICT = path.join(__dirname, '..', 'src', 'data.js');

// 连字符、撇号都保留，否则 up-to-date / air-conditioning 这类词永远查不到
const OK = /^[a-z][a-z'\-]*$/;

function loadCounts() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const rank = new Map();
  let n = 0;
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf('\t');
    if (i < 1) continue;
    const w = line.slice(0, i).toLowerCase();
    if (!OK.test(w)) continue;
    n += 1;
    if (!rank.has(w)) rank.set(w, n); // 同一个词出现多次只认第一次（排名最靠前那次）
  }
  return rank;
}

function readDict(file) {
  const p = path.join(__dirname, '..', 'src', file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('\t');
      return (i < 0 ? l : l.slice(0, i)).trim();
    })
    .filter(Boolean);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('找不到词频源文件：' + SRC);
    console.error('下载：curl -sL -o build/freq/count_1w.txt https://norvig.com/ngrams/count_1w.txt');
    process.exit(1);
  }

  const rank = loadCounts();
  const words = [...readDict('cet4-words.txt'), ...readDict('cet6-words.txt')];

  const out = {};
  let hit = 0;
  const miss = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (k in out) continue;
    if (rank.has(k)) {
      out[k] = rank.get(k);
      hit += 1;
    } else if (!miss.includes(k)) {
      miss.push(k);
    }
  }

  const sorted = {};
  Object.keys(out)
    .sort()
    .forEach((k) => { sorted[k] = out[k]; });

  fs.writeFileSync(OUT, JSON.stringify(sorted) + '\n', 'utf8');

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('词频源 ' + rank.size + ' 条');
  console.log('词表共 ' + new Set(words.map((w) => w.toLowerCase())).size + ' 个不重复词');
  console.log('命中 ' + hit + ' 个，缺 ' + miss.length + ' 个');
  console.log('产出 ' + path.relative(path.join(__dirname, '..'), OUT) + '  ' + kb + ' KB');
  if (miss.length) {
    console.log('缺频次的词（排序时排到该段末尾）：');
    console.log('  ' + miss.join(', '));
  }
}

main();
