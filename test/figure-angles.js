/* ============================================================
   简笔画的「临床角度」推导（只给测试和复核单用，不随应用发布）

   为什么需要它：figures.test.js 原有断言只管"几何自洽"（肢段等长、两帧同一人、
   不穿地），管不了"图和动作自己的文字要领对不对得上"。v0.2.31 把关节角度算出来
   对照 data-exercises.js 的原文，一跑就抓出 4 张线上图与要领矛盾：坐站转移脚在膝前、
   踝泵的"勾脚"其实是跖屈、桥式踮着脚、踏步没画扶持物。

   ⚠️ 这是火柴人角度，不是临床测量。躯干只有一根刚体，「躯干-大腿角」里含着腰椎
      前屈，并不等于真实的髋关节角度。所以 ROM 包络故意放宽，只拦明显画错的姿势
      （如跖屈 96°、关节反向），不能拿这些数字去替代量角器。

   角度约定：屏幕坐标 y 向下，「逆时针为正」。现有图都是**右手系**——朝右站/坐，
   或仰卧头朝左（都是朝右站立旋转而来），屈曲一律是逆时针。将来若画朝左的图，
   镜像后符号全反，ROM 断言会立刻报错；那时给该图加镜像标记再取反，别改这里的定义。
   ============================================================ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dirOf = v => (Math.atan2(v[1], v[0]) * 180) / Math.PI;

/* 从向量 u 转到向量 v 的角度：逆时针为正，归一到 [-180, 180) */
function ccw(u, v) {
  const a = -(dirOf(v) - dirOf(u));
  return ((a + 540) % 360) - 180;
}

/* 一帧姿势的各关节角度（度）。缺关节的项不出现。
   - shoulder 肩前屈：躯干向下方向 → 上臂；0=手臂贴着躯干下垂，正=向前举
   - elbow    肘屈：上臂 → 前臂；0=伸直
   - hip      躯干-大腿角（≈髋屈，含腰椎前屈）：躯干延长线 → 大腿；0=站直，负=后伸
   - knee     膝屈：大腿 → 小腿；0=伸直（膝向后弯是顺时针，所以取反）
   - ankle    踝：小腿 → 脚，减 90；0=脚与小腿垂直，正=背屈（勾脚），负=跖屈（绷脚）
   - trunk    躯干前倾：竖直向上 → 躯干；正=向前倾。只对站/坐的图有意义
   带 2 的是远侧肢体（el2/wr2、kn2/an2/toe2）。 */
function jointAngles(p) {
  const has = (...ks) => ks.every(k => Array.isArray(p[k]));
  const out = {};
  if (has('sh', 'hip')) out.trunk = -ccw([0, -1], sub(p.sh, p.hip));
  if (has('sh', 'hip', 'el')) out.shoulder = ccw(sub(p.hip, p.sh), sub(p.el, p.sh));
  if (has('sh', 'el', 'wr')) out.elbow = ccw(sub(p.el, p.sh), sub(p.wr, p.el));
  if (has('sh', 'hip', 'el2')) out.shoulder2 = ccw(sub(p.hip, p.sh), sub(p.el2, p.sh));
  if (has('sh', 'el2', 'wr2')) out.elbow2 = ccw(sub(p.el2, p.sh), sub(p.wr2, p.el2));
  if (has('sh', 'hip', 'kn')) out.hip = ccw(sub(p.hip, p.sh), sub(p.kn, p.hip));
  if (has('hip', 'kn', 'an')) out.knee = -ccw(sub(p.kn, p.hip), sub(p.an, p.kn));
  if (has('kn', 'an', 'toe')) out.ankle = ccw(sub(p.an, p.kn), sub(p.toe, p.an)) - 90;
  if (has('sh', 'hip', 'kn2')) out.hip2 = ccw(sub(p.hip, p.sh), sub(p.kn2, p.hip));
  if (has('hip', 'kn2', 'an2')) out.knee2 = -ccw(sub(p.kn2, p.hip), sub(p.an2, p.kn2));
  if (has('kn2', 'an2', 'toe2')) out.ankle2 = ccw(sub(p.an2, p.kn2), sub(p.toe2, p.an2)) - 90;
  return out;
}

/* 宽松的活动度包络 [下限, 上限]（度）。常用正常值见 docs/RESEARCH.md §十；
   这里在正常值外再放一圈余量，只用来拦"人做不到"的姿势。 */
const ROM = {
  shoulder: [-60, 180],   // 后伸约 50～60，前屈约 180
  elbow: [-10, 150],      // 伸直 0（允许少许过伸），屈约 145～150
  hip: [-30, 140],        // 真实髋屈约 120～125；火柴人含腰椎前屈，故放宽到 140
  knee: [-5, 150],        // 伸直 0，屈约 135～150
  ankle: [-60, 30],       // 背屈约 20，跖屈约 45～50
};

/* 给复核单用的中文名与常用正常范围 */
const LABELS = {
  trunk: '躯干前倾（相对竖直）',
  shoulder: '肩前屈（上臂与躯干夹角）',
  elbow: '肘屈（0°=伸直）',
  hip: '躯干-大腿角（≈髋屈，含腰椎前屈）',
  knee: '膝屈（0°=伸直）',
  ankle: '踝（勾脚＝背屈，绷脚＝跖屈）',
};
const NORMAL = {
  trunk: '—',
  shoulder: '前屈 0～180°',
  elbow: '0～150°',
  hip: '髋屈 0～120°',
  knee: '0～135°',
  ankle: '背屈 0～20°，跖屈 0～50°',
};

/* 脚是否平踏在支撑面（地面/床面）上：踝在支撑面上方 2.5～4、脚（踝→趾）方向在
   水平 ±10° 内。对应 figures.js 里 foot() 的楔形——鞋底比踝→趾连线低约 2.4～3.4，
   所以踝离支撑面 3 左右、脚放平，鞋底才正好贴住；脚方向一斜，脚跟就离地成了踮脚。 */
function footPlanted(an, toe, groundY) {
  const height = groundY - an[1];
  const dir = dirOf(sub(toe, an));
  return { height, dir, ok: height >= 2.5 && height <= 4 && Math.abs(dir) <= 10 };
}

module.exports = { ccw, jointAngles, ROM, LABELS, NORMAL, footPlanted };
