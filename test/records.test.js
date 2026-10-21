/* 记录页小结回归：Node 直接运行，使用实际判定与 esc，不接触患者数据。
   node test/records.test.js [源码目录（可选，用于旧版本反验）]
   不处于目标内 ≠ 偏高；小结复用单条判定，安全提示先于目标内次数和首尾差值。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const profile = { height: '', targets: { bpSys: 140, bpDia: 90, gluFast: 7, gluPost: 10 } };
const context = vm.createContext({
  navigator: { userAgent: 'records-test', maxTouchPoints: 0 },
  Store: { data: { profile } },
  setTimeout, clearTimeout,
});
for (const file of ['js/app/core.js', 'js/app/records.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const summary = (kind, list) => {
  context.kind = kind;
  context.list = list;
  const before = JSON.stringify({ list, profile });
  const html = vm.runInContext('chartSummaryHTML(kind, list)', context);
  assert.strictEqual(JSON.stringify({ list, profile }), before, '生成小结不得改测量记录或个人目标');
  return html;
};
const bp = (sys, dia) => ({ date: '2026-10-20', sys, dia });
const glu = (value, gtype = '空腹') => ({ date: '2026-10-20', value, gtype });
const expectText = (html, text) => assert(html.includes(text), `缺少 ${text}：${html}`);
const beforeText = (html, first, second) => {
  expectText(html, first); expectText(html, second);
  assert(html.indexOf(first) < html.indexOf(second), `${first} 应先于 ${second}：${html}`);
};

assert.strictEqual(summary('bp', []), '');
assert.strictEqual(summary('glucose', [glu(6)]), '');
let html = summary('bp', [bp(85, 55), bp(88, 58)]);
expectText(html, '有 2 次偏低，注意头晕跌倒');
assert(!html.includes('超过'), '偏低不能被写成超过目标');
beforeText(html, '偏低', '高压比最早一条高了 3');
html = summary('glucose', [glu(3.5), glu(3.7)]);
expectText(html, '有 2 次偏低，警惕低血糖');
assert(!html.includes('超过'), '低血糖不能被写成超过目标');
beforeText(html, '警惕低血糖', '血糖比最早一条高了 0.2');

html = summary('bp', [bp(150, 95), bp(155, 98)]);
expectText(html, '有 2 次偏高（超过您的目标值）');
assert(!html.includes('偏低'));
html = summary('glucose', [glu(8), glu(9)]);
expectText(html, '有 2 次空腹偏高（超过您的目标值）');
html = summary('bp', [bp(85, 55), bp(150, 95)]);
expectText(html, '有 1 次偏低'); expectText(html, '有 1 次偏高');
assert(!html.includes('都超过'), '混合状态不能声称全都偏高');
html = summary('glucose', [glu(3.5), glu(6), glu(8)]);
expectText(html, '有 1 次偏低'); expectText(html, '有 1 次空腹偏高');
beforeText(html, '警惕低血糖', '有 1 次在您的目标内（遵医嘱）');
beforeText(html, '空腹偏高', '有 1 次在您的目标内（遵医嘱）');

// 不同严重度要分别保留，危险提示不能被其他记录或首尾下降掩盖。
html = summary('bp', [bp(150, 95), bp(180, 110), bp(85, 55), bp(120, 80)]);
beforeText(html, '有 1 次血压很高，尽快联系医生', '有 1 次偏高');
beforeText(html, '血压很高', '高压比最早一条低了 30');
expectText(html, '有 1 次偏低');
html = summary('glucose', [glu(8), glu(11), glu(3.5), glu(6)]);
beforeText(html, '有 1 次明显偏高，联系医生', '有 1 次空腹偏高');
expectText(html, '有 1 次偏低，警惕低血糖');

// 同类提示合并计数，不把空腹、餐后、随机的个人目标混在一起判断。
html = summary('glucose', [glu(8), glu(9), glu(11, '餐后2小时'), glu(12, '随机')]);
expectText(html, '有 2 次空腹偏高'); expectText(html, '有 2 次偏高');
html = summary('bp', [bp(120, 80), bp(130, 85)]);
expectText(html, '有 2 次在您的目标内（遵医嘱）');
assert(!/偏低|偏高/.test(html));
html = summary('weight', [{ value: 62 }, { value: 61.5 }]);
expectText(html, '体重比最早一条低了 0.5 公斤');
assert(!/目标|偏低|偏高/.test(html), '体重仍只描述差值，不套血压/血糖判定');

// 不改变既有阈值及分支优先级：对边界两侧和个人目标做独立期望核对。
const checks = [
  ['bpBadge(89, 60)', ['warn', '偏低，注意头晕跌倒']],
  ['bpBadge(90, 59)', ['warn', '偏低，注意头晕跌倒']],
  ['bpBadge(90, 60)', ['ok', '在您的目标值内（遵医嘱）']],
  ['bpBadge(140, 90)', ['ok', '在您的目标值内（遵医嘱）']],
  ['bpBadge(141, 90)', ['warn', '偏高（超过您的目标值）']],
  ['bpBadge(140, 91)', ['warn', '偏高（超过您的目标值）']],
  ['bpBadge(180, 80)', ['bad', '血压很高，尽快联系医生']],
  ['bpBadge(170, 110)', ['bad', '血压很高，尽快联系医生']],
  ['bpBadge(180, 55)', ['bad', '血压很高，尽快联系医生']],
  ["gluBadge('空腹', 3.9)", ['bad', '偏低，警惕低血糖']],
  ["gluBadge('空腹', 4)", ['ok', '空腹在您的目标内（遵医嘱）']],
  ["gluBadge('空腹', 7)", ['ok', '空腹在您的目标内（遵医嘱）']],
  ["gluBadge('空腹', 7.1)", ['warn', '空腹偏高（超过您的目标值）']],
  ["gluBadge('空腹', 10)", ['warn', '空腹偏高（超过您的目标值）']],
  ["gluBadge('空腹', 10.1)", ['bad', '明显偏高，联系医生']],
  ["gluBadge('餐后2小时', 10)", ['ok', '在您的目标内（遵医嘱）']],
  ["gluBadge('餐后2小时', 10.1)", ['warn', '偏高（超过您的目标值）']],
  ["gluBadge('餐后2小时', 13.9)", ['bad', '明显偏高，联系医生']],
  ["gluBadge('随机', 3.9)", ['bad', '偏低，警惕低血糖']],
];
for (const [expression, expected] of checks) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext(expression, context))), expected, expression);
}
profile.targets = { bpSys: 130, bpDia: 80, gluFast: 6, gluPost: 8 };
html = summary('bp', [bp(135, 85), bp(140, 90)]);
expectText(html, '有 2 次偏高');
html = summary('glucose', [glu(6.5), glu(8.5, '餐后2小时')]);
expectText(html, '有 1 次空腹偏高'); expectText(html, '有 1 次偏高');
html = summary('glucose', [glu(3.9), glu(6)]);
expectText(html, '警惕低血糖'); expectText(html, '有 1 次在您的目标内（遵医嘱）');

console.log('✅ 记录页小结全部断言通过（偏低/偏高/混合、危险优先、个人目标与边界、无副作用）');
