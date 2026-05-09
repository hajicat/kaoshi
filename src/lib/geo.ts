/**
 * 地理位置工具函数（多校区版）
 *
 * 覆盖长春市全部 29 所本科高校（18 公办 + 11 民办），共约 40+ 个校区
 *
 * 排序：985 → 211 → 吉林动画学院 → 其余按用户指定顺序
 *
 * 邮箱验证规则：
 *   - 需校内邮箱：吉林大学、长春理工大学、长春工业大学、东北师范大学、吉林建筑大学、吉林外国语大学、长春大学、长春中医药大学
 *   - GPS 验证即可（任意邮箱）：其余 21 所学校
 */

/** 地球半径（公里） */
export const EARTH_RADIUS_KM = 6371

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

// ════════════════════════════════════════════
// 校区坐标数据
// ════════════════════════════════════════════

interface Campus {
  name: string           // 校区名称
  lat: number            // 纬度
  lng: number            // 经度
  schoolName: string     // 所属学校全称
  schoolShort: string    // 学校简称
  radiusKm: number       // GPS 验证半径（km）
}

/**
 * 所有校区的 GPS 坐标列表
 *
 * 排序：985 → 211 → 吉林动画学院 → 其余按用户指定顺序
 *
 * 邮箱验证：
 *   - 需校内邮箱（requiresSchoolEmail=true）：吉大、长理工、长工大、吉建大、东师、吉外、长大
 *   - 仅 GPS 验证即可（任意邮箱）：其余 21 所学校（含长中医）
 */

const CAMPUSES: Campus[] = [
  // ══════════════════════════════════
  // 985：吉林大学（6 个校区）
  // ══════════════════════════════════
  { name: '吉林大学(前卫南区)',   lat: 43.82510,  lng: 125.26190,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.5 },
  { name: '吉林大学(南岭校区)',   lat: 43.85546,  lng: 125.33310,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.0 },
  { name: '吉林大学(朝阳校区)',   lat: 43.882894,  lng: 125.308502,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.0 },
  { name: '吉林大学(南湖校区)',   lat: 43.84509,  lng: 125.28594,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.0 },
  { name: '吉林大学(和平校区)',   lat: 43.90834,  lng: 125.26122,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.0 },
  { name: '吉林大学(新民校区)',   lat: 43.86817,  lng: 125.30325,
    schoolName: '吉林大学',      schoolShort: '吉大',     radiusKm: 2.0 },

  // ══════════════════════════════════
  // 公办本科（需校内邮箱）
  // ══════════════════════════════════
  { name: '长春理工大学(朝阳校区/东区)', lat: 43.838705, lng: 125.315539,
    schoolName: '长春理工大学',   schoolShort: '长理工',   radiusKm: 1.5 },
  { name: '长春理工大学(朝阳校区/南区)', lat: 43.830422, lng: 125.313534,
    schoolName: '长春理工大学',   schoolShort: '长理工',   radiusKm: 1.5 },
  { name: '长春理工大学(朝阳校区/西区)', lat: 43.835226, lng: 125.301320,
    schoolName: '长春理工大学',   schoolShort: '长理工',   radiusKm: 1.5 },
  { name: '长春理工大学(西校区)', lat: 43.83231,  lng: 125.29870,
    schoolName: '长春理工大学',   schoolShort: '长理工',   radiusKm: 1.5 },
  { name: '长春理工大学(春明湖校区)', lat: 44.11561, lng: 125.556687,
    schoolName: '长春理工大学',   schoolShort: '长理工',   radiusKm: 1.5 },

  { name: '长春工业大学(南湖校区)', lat: 43.850246, lng: 125.283156,
    schoolName: '长春工业大学',   schoolShort: '长工大',   radiusKm: 1.5 },
  { name: '长春工业大学(北湖校区)', lat: 43.994505,  lng: 125.398967,
    schoolName: '长春工业大学',   schoolShort: '长工大',   radiusKm: 1.5 },

  { name: '吉林建筑大学',         lat: 43.79204,  lng: 125.40403,
    schoolName: '吉林建筑大学',   schoolShort: '吉建大',   radiusKm: 1.5 },

  // ══════════════════════════════════
  // 211：东北师范大学（2 个校区）
  // ══════════════════════════════════
  { name: '东北师范大学(净月)',   lat: 43.82365,  lng: 125.41901,
    schoolName: '东北师范大学',   schoolShort: '东师',     radiusKm: 2.0 },
  { name: '东北师范大学(自由)',   lat: 43.85945,  lng: 125.32485,
    schoolName: '东北师范大学',   schoolShort: '东师',     radiusKm: 1.5 },

  // ══════════════════════════════════
  // ★ 吉林动画学院（创始人学校，排位靠前）
  // ══════════════════════════════════
  { name: '吉林动画学院',         lat: 43.81824,  lng: 125.254561,
    schoolName: '吉林动画学院',   schoolShort: '吉动',     radiusKm: 1.5 },

  // ══════════════════════════════════
  // 民办（需校内邮箱）
  // ══════════════════════════════════
  { name: '吉林外国语大学',       lat: 43.819730, lng: 125.440380,
    schoolName: '吉林外国语大学', schoolShort: '吉外',     radiusKm: 2.0 },

  // ══════════════════════════════════
  // 其余公办本科（仅 GPS 验证）
  // ══════════════════════════════════
  { name: '吉林农业大学',         lat: 43.81310,  lng: 125.40369,
    schoolName: '吉林农业大学',   schoolShort: '吉农大',   radiusKm: 1.5 },

  { name: '长春中医药大学(主校区)', lat: 43.82863,  lng: 125.41080,
    schoolName: '长春中医药大学', schoolShort: '长中医',   radiusKm: 1.5 },
  { name: '长春中医药大学(红旗校区)', lat: 43.865768, lng: 125.297290,
    schoolName: '长春中医药大学', schoolShort: '长中医',   radiusKm: 0.3 },

  { name: '吉林工程技术师范学院',  lat: 43.93787,  lng: 125.31202,
    schoolName: '吉林工程技术师范学院',schoolShort:'吉工程师',radiusKm: 1.5 },

  { name: '长春师范大学',         lat: 43.91250,  lng: 125.388308,
    schoolName: '长春师范大学',   schoolShort: '长师大',   radiusKm: 1.5 },

  { name: '吉林财经大学',         lat: 43.816064, lng: 125.428717,
    schoolName: '吉林财经大学',   schoolShort: '吉财大',   radiusKm: 2.0 },

  { name: '吉林体育学院',         lat: 43.860695, lng: 125.332777,
    schoolName: '吉林体育学院',   schoolShort: '吉体院',   radiusKm: 1.5 },

  { name: '吉林艺术学院',         lat: 43.862015, lng: 125.31046,
    schoolName: '吉林艺术学院',   schoolShort: '吉艺',     radiusKm: 1.5 },

  { name: '吉林工商学院',         lat: 43.98975,  lng: 125.53350,
    schoolName: '吉林工商学院',   schoolShort: '吉工商',   radiusKm: 1.5 },

  { name: '长春工程学院',         lat: 43.84906,  lng: 125.280727,
    schoolName: '长春工程学院',   schoolShort: '长工程',   radiusKm: 1.5 },

  { name: '吉林警察学院',         lat: 43.82714,  lng: 125.407473,
    schoolName: '吉林警察学院',   schoolShort: '吉警院',   radiusKm: 1.5 },

  { name: '长春大学',             lat: 43.831684, lng: 125.31768,
    schoolName: '长春大学',       schoolShort: '长大',     radiusKm: 1.5 },

  { name: '长春汽车职业技术大学', lat: 43.82948, lng: 125.14691,
    schoolName: '长春汽车职业技术大学',schoolShort:'汽职大',  radiusKm: 1.5 },

  { name: '长春职业技术大学',     lat: 43.82723,  lng: 125.36059,
    schoolName: '长春职业技术大学', schoolShort:'职技大',  radiusKm: 1.5 },

  // ══════════════════════════════════
  // 其余民办本科（仅 GPS 验证）
  // ══════════════════════════════════
  { name: '长春光华学院',         lat: 43.87400,  lng: 125.42883,
    schoolName: '长春光华学院',   schoolShort: '光华',     radiusKm: 1.5 },

  { name: '长春工业大学人文信息学院',lat: 43.779358, lng: 125.421201,
    schoolName: '长春工业大学人文信息学院',schoolShort:'人信学院',radiusKm: 1.5 },

  { name: '长春电子科技学院',     lat: 43.999146, lng: 125.148305,
    schoolName: '长春电子科技学院',schoolShort:'电子学院', radiusKm: 1.5 },

  { name: '长春财经学院',         lat: 43.78594,  lng: 125.40719,
    schoolName: '长春财经学院',   schoolShort: '长财经',   radiusKm: 1.5 },

  { name: '吉林建筑科技学院',     lat: 43.99330,  lng: 125.14190,
    schoolName: '吉林建筑科技学院',schoolShort:'建科',     radiusKm: 1.5 },

  { name: '长春建筑学院',         lat: 43.69444,  lng: 125.51792,
    schoolName: '长春建筑学院',   schoolShort: '长建筑',   radiusKm: 1.5 },

  { name: '长春科技学院',         lat: 43.53066,  lng: 125.66176,
    schoolName: '长春科技学院',   schoolShort: '长科技',   radiusKm: 1.5 },

  { name: '长春大学旅游学院',     lat: 43.68863,  lng: 125.513177,
    schoolName: '长春大学旅游学院',schoolShort:'旅游学院', radiusKm: 1.5 },

  { name: '长春人文学院',         lat: 43.819557, lng: 125.40416,
    schoolName: '长春人文学院',   schoolShort: '长人文',   radiusKm: 1.5 },
]

// ════════════════════════════════════════════
// 验证逻辑
// ════════════════════════════════════════════

/** 判断是否在吉林动画学院范围内（允许任意邮箱注册） */
function isJLAI(lat: number, lng: number): boolean {
  // 找吉林动画学院（不再依赖数组索引）
  const jlai = CAMPUSES.find(c => c.schoolShort === '吉动')
  if (!jlai) return false
  return haversineDistance(jlai.lat, jlai.lng, lat, lng) <= jlai.radiusKm
}

/** 单个匹配校区（用于前端下拉选择） */
export interface NearbyCampus {
  name: string           // 校区名称，如 "吉林大学(前卫南区)"
  schoolName: string     // 学校全称，如 "吉林大学"
  schoolShort: string    // 简称，如 "吉大"
  distanceKm: number     // 用户到该校区的距离（km）
  requiresSchoolEmail: boolean // 该学校是否需要校内邮箱
}

/**
 * 查找用户所在的匹配校区
 * 返回所有在范围内的校区列表 + 是否需要校内邮箱（以最近校区为准）
 *
 * 当多个校区重叠时返回 nearbyCampuses 数组供用户选择，
 * 默认选中离用户最近的那个。
 */
export function verifyLocation(lat: number, lng: number):
  | { valid: false; message: string; nearestCampus?: string; nearestDistance?: number }
  | { valid: true; location: string; requiresSchoolEmail: boolean; nearestCampus: string; nearestDistance: number; nearbyCampuses: NearbyCampus[] } {

  // 收集所有在范围内的校区 + 记录最近的
  const matchingCampuses: NearbyCampus[] = []
  let nearestCampus: Campus | null = null
  let nearestDist = Infinity

  for (const c of CAMPUSES) {
    const dist = haversineDistance(c.lat, c.lng, lat, lng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearestCampus = c
    }
    if (dist <= c.radiusKm) {
      matchingCampuses.push({
        name: c.name,
        schoolName: c.schoolName,
        schoolShort: c.schoolShort,
        distanceKm: Math.round(dist * 100) / 100,
        requiresSchoolEmail: ['吉大','长理工','长工大','吉建大','东师','吉外','长大'].includes(c.schoolShort),
      })
    }
  }

  // 按距离排序（最近的在前）
  matchingCampuses.sort((a, b) => a.distanceKm - b.distanceKm)

  if (matchingCampuses.length > 0) {
    const selected = matchingCampuses[0] // 默认选最近的
    return {
      valid: true,
      location: selected.name,
      requiresSchoolEmail: selected.requiresSchoolEmail,
      nearestCampus: selected.name,
      nearestDistance: selected.distanceKm,
      nearbyCampuses: matchingCampuses,
    }
  }

  // 未在任何校区内，返回最近校区作为提示
  if (nearestCampus && nearestDist <= 10) {
    return {
      valid: false,
      message: `你当前不在任何校区范围内。最近的「${nearestCampus.name}」距离 ${(nearestDist).toFixed(1)}km，请到校园内再试`,
      nearestCampus: nearestCampus.name,
      nearestDistance: Math.round(nearestDist * 100) / 100,
    }
  }

  return {
    valid: false,
    message: 'GPS 定位显示您不在长春高校区域内，无法使用此平台',
  }
}

/**
 * GPS 采样评分（用于问卷提交时的学生验证）
 * 适用于：吉林动画学院、长春大学（无学校邮箱，需要连续采样验证）
 *
 * 评分维度：
 * - 校内命中数（主要）
 * - 位置稳定性（采样点之间距离）
 * - 采样点数量（至少要有 2 个）
 *
 * @param samples GPS 采样点数组 [{ lat, lng, accuracy?, timestamp? }]
 * @param schoolShort 学校简称（'吉动' | '长大'）
 * @returns 评分（0-100），及诊断信息
 */
export function scoreGpsSamples(
  samples: Array<{ lat: number; lng: number; accuracy?: number; timestamp?: number }>,
  schoolShort: string
): { score: number; details: string } {
  const CAMPUS_MAP: Record<string, { lat: number; lng: number; radiusKm: number }> = {
    // 创始人学校（原数据）
    '吉动':   { lat: 43.81824, lng: 125.254561, radiusKm: 1.5 },
    '长大':   { lat: 43.831684, lng: 125.31768, radiusKm: 1.5 },
    '吉艺':   { lat: 43.862015, lng: 125.31046, radiusKm: 1.5 },
    // 新增公办
    '吉农大': { lat: 43.81310, lng: 125.40369, radiusKm: 1.5 },
    '长中医': { lat: 43.82863, lng: 125.41080, radiusKm: 1.5 },
    '吉工程师':{ lat: 43.93787, lng: 125.31202, radiusKm: 1.5 },
    '长师大': { lat: 43.91250, lng: 125.388308, radiusKm: 1.5 },
    '吉财大': { lat: 43.816064, lng: 125.428717, radiusKm: 2.0 },
    '吉体院': { lat: 43.860695, lng: 125.332777, radiusKm: 1.5 },
    '吉工商': { lat: 43.98975, lng: 125.53350, radiusKm: 1.5 },
    '长工程': { lat: 43.84906, lng: 125.280727, radiusKm: 1.5 },
    '吉警院': { lat: 43.82714, lng: 125.407473, radiusKm: 1.5 },
    '汽职大': { lat: 43.82948, lng: 125.14691, radiusKm: 1.5 },
    '职技大': { lat: 43.82723, lng: 125.36059, radiusKm: 1.5 },
    // 新增民办
    '光华':   { lat: 43.87400, lng: 125.42883, radiusKm: 1.5 },
    '人信学院':{ lat: 43.779358, lng: 125.421201, radiusKm: 1.5 },
    '电子学院':{ lat: 43.999146, lng: 125.148305, radiusKm: 1.5 },
    '长财经': { lat: 43.78594, lng: 125.40719, radiusKm: 1.5 },
    '建科':   { lat: 43.99330, lng: 125.14190, radiusKm: 1.5 },
    '长建筑': { lat: 43.69444, lng: 125.51792, radiusKm: 1.5 },
    '长科技': { lat: 43.53066, lng: 125.66176, radiusKm: 1.5 },
    '旅游学院':{ lat: 43.68863, lng: 125.513177, radiusKm: 1.5 },
    '长人文': { lat: 43.819557, lng: 125.40416, radiusKm: 1.5 },
  }

  const campus = CAMPUS_MAP[schoolShort]
  if (!campus) {
    return { score: 0, details: '未知学校类型，无需 GPS 验证' }
  }

  if (!samples || samples.length === 0) {
    return { score: 0, details: '无 GPS 采样数据' }
  }

  // 总采样数
  const sampleCount = samples.length
  let insideCount = 0
  const validDistances: number[] = [] // 仅有效采样的校内距离
  let validSampleCount = 0              // 有效采样数（精度合理的）

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    // 精度 > 200m 的采样点视为无效，不参与评分（可能是 GPS 信号差）
    if (s.accuracy && s.accuracy > 200) continue
    validSampleCount++
    const dist = haversineDistance(campus.lat, campus.lng, s.lat, s.lng)
    validDistances.push(dist)
    if (dist <= campus.radiusKm) {
      insideCount++
    }
  }

  // 基础分：以有效采样数计算（防止低精度无效采样拉低分数）
  const effectiveCount = validSampleCount || sampleCount
  const countBonus = Math.min(effectiveCount * 10, 30) // 最多 30 分

  // 位置稳定性评分（基于有效采样点的校内平均距离）
  let stabilityBonus = 0
  if (validDistances.length >= 2) {
    const avgDist = validDistances.reduce((a, b) => a + b, 0) / validDistances.length
    // 校内平均距离越小越稳定
    const stableBonus = Math.max(0, 20 - avgDist * 10) // 校内平均距离 0→20分，2km→0分
    stabilityBonus = Math.round(stableBonus)
  }

  // 校内命中比例（主要指标，基于有效采样）
  const insideRatio = effectiveCount > 0 ? insideCount / effectiveCount : 0
  const insideBonus = Math.round(insideRatio * 50) // 最多 50 分

  // GPS 精度加权（精度合理 10-100m 的采样点权重更高；<5m 可能为虚拟定位）
  let weightedInsideRatio = insideCount
  let totalWeight = effectiveCount
  for (const s of samples) {
    if (s.accuracy && s.accuracy > 5 && s.accuracy <= 100) {
      // 合理精度（6-100m）额外加权
      weightedInsideRatio += 0.1
      totalWeight += 0.1
    }
  }
  const precisionBonus = effectiveCount > 0
    ? Math.round((weightedInsideRatio / totalWeight) * 10)
    : 0 // 最多 10 分

  const totalScore = Math.min(countBonus + insideBonus + stabilityBonus + precisionBonus, 100)

  const invalidCount = sampleCount - validSampleCount
  const details = [
    `采样${sampleCount}次（有效${validSampleCount}次${invalidCount > 0 ? `，精度过差${invalidCount}次已排除` : ''}）`,
    `校内命中${insideCount}次（${Math.round(insideRatio * 100)}%）`,
    `位置稳定性+${stabilityBonus}，精度加权+${precisionBonus}`,
    `总评分：${totalScore}`,
  ].join('；')

  return { score: totalScore, details }
}

/**
 * 判断用户是否为"无邮箱验证学校"（GPS 验证即可，任意邮箱）
 * 这类用户在问卷提交时需要 GPS 采样验证
 */
export const NO_EMAIL_SCHOOLS: Set<string> = new Set([
  '吉动', '吉艺', '吉农大', '吉工程师', '长师大', '吉财大',
  '吉体院', '吉工商', '长工程', '吉警院', '汽职大', '职技大',
  '光华', '人信学院', '电子学院', '长财经', '建科', '长建筑', '长科技', '旅游学院', '长人文', '长中医'
])

export function isNoEmailSchool(schoolShort: string): boolean {
  return NO_EMAIL_SCHOOLS.has(schoolShort)
}

/**
 * 根据学校全称获取简称
 * 用于 survey/route.ts 等地方，只有 school 全名但需要 schoolShort 的场景
 */
export function getSchoolShort(schoolName: string): string | null {
  const campus = CAMPUSES.find(c => c.schoolName === schoolName)
  return campus ? campus.schoolShort : null
}
