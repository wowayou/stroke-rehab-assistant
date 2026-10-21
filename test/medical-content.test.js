/* 医学安全文案护栏：Node 直接运行，不替代指南更新检查或医生专业复核。
   node test/medical-content.test.js [源码目录（可选，用于旧版本反验）]
   对照来源只在 docs/RESEARCH.md 维护；这里守适用范围和不得弱化的警示。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({});
vm.runInContext(read('js/data-articles.js'), context, { filename: 'js/data-articles.js' });
const articles = JSON.parse(vm.runInContext('JSON.stringify(ARTICLES)', context));
const plain = html => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const prevention = articles.find(a => a.id === 'prevention');
const followup = articles.find(a => a.id === 'followup');
assert(prevention && followup, '文章 id 不应因安全修正改变');

const medSection = prevention.body.split('<h3>2.')[0];
const items = [...medSection.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => plain(m[1]));
const shortCourse = items.find(text => /3\s*周/.test(text));
assert(shortCourse, '保留有来源依据的短期方案，不把医学事实整段删除');
for (const condition of ['发病 24 小时内', '非心源性', '轻型脑梗', '高危短暂性脑缺血发作', '医生', '阿司匹林', '氯吡格雷']) {
  assert(shortCourse.includes(condition), `三周方案必须在同条说明 ${condition}，不能泛化到所有双抗`);
}
const stentException = items.find(text => text.includes('颈动脉支架术后'));
assert(stentException && /不能照搬.*三周/.test(stentException), '颈动脉支架术后必须明确不能照搬三周方案');
assert(stentException.includes('专科医生确定'), '不替支架患者决定疗程');
for (const warning of ['不要自行延长', '提前停药', '恢复双抗', '改成单药']) {
  assert(stentException.includes(warning), `双抗必须保留 ${warning} 警示`);
}
assert(!medSection.includes('这种吃法通常'), '不得恢复按药物数量推断统一疗程的旧句');
assert(!/支架术后[^。；]*至少[^。；]*[\d一二三四五六七八九十]+\s*(?:天|周|月)/.test(plain(medSection)), '本修正不新增统一的支架停药期限');
assert(prevention.body.includes('所有药物和目标值的调整，都必须由医生决定'), '总免责声明不能删弱');

const warningMatch = followup.body.match(/<div class="art-warn">([\s\S]*?)<\/div>/);
assert(warningMatch, '急诊提示不能藏在绿色普通提示中');
const emergency = plain(warningMatch[1]);
assert(warningMatch.index < followup.body.indexOf('<h3>复诊节奏'), '急诊提示应先于常规复诊流程');
for (const signal of ['突然出现或突然加重', '一侧麻木无力', '口角歪斜', '说话不清', '看不见或视野缺损', '站不稳']) {
  assert(emergency.includes(signal), `复诊文章需明确突发症状：${signal}`);
}
assert(/立即拨打\s*120/.test(emergency) && emergency.includes('不要等门诊'), '新发卒中信号应立即拨120，不是仅尽快就医');
assert(emergency.includes('即使几分钟后缓解') && emergency.includes('急诊评估'), '症状缓解不取消急诊警示');
assert(emergency.includes('不要自行开车'), '保留救护车而非自行开车的提示');
for (const other of ['大便发黑', '消化道出血', '肌肉酸痛乏力', '服他汀者', '头晕持续或加重', '尽快就医']) {
  assert(followup.body.includes(other), `其他就医警示不得删除：${other}`);
}
assert(!/<div class="art-tip">[^<]*新发麻木无力/.test(followup.body), '不可再把卒中急诊信号与一般不适混成普通提示');
assert(!/双抗吃满约\s*3\s*周改单药/.test(read('README.md')), 'README 不能留下无适用范围的三周停药示例');
assert.strictEqual(vm.runInContext('BEFAST.length', context), 6, '急救六条识别要点仍保留');

console.log('✅ 医学安全文案护栏通过（双抗适用范围/支架例外、突发症状立即120、其他警示保留）');
