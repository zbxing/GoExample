'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  BookOpen,
  FileCode2,
  FileText,
  Link2,
  Menu,
  Package,
  Shield,
  UserRound,
} from 'lucide-react';

const METRIC_SERIES = [
  [12, 22, 32, 45, 32, 78, 89, 92],
  [1, 2, 43, 5, 67, 78, 89, 12],
  [12, 22, 32, 45, 32, 78, 89, 92],
] as const;

const metrics = [
  { label: '访问人数', value: '268,500', delta: '+80%', series: METRIC_SERIES[0] },
  { label: '新增客户', value: '268,500', delta: '+80%', series: METRIC_SERIES[1] },
  { label: '解决数量', value: '268,500', delta: '+80%', series: METRIC_SERIES[2] },
] as const;

const plugins = [
  ['[BBS] 极光论坛--基于G...', '面向 gin-vue-admin 的论坛社区插件，提供版块、用户、帖子、评论、经验体系。', '¥ 3688'],
  ['[fnaClaw] 适配 FNA 的...', '适配 FNA 的多端兼容 claw，为内嵌的管理后台提供 Web 管理能力。', '¥ 599'],
  ['FNA 开发者...', '围绕权限、菜单和接口快速生成后台代码，减少重复的基础配置工作。', '¥ 299'],
  ['表单设计器增强', '可视化表单编排与字段校验扩展，降低复杂业务表单交付成本。', '¥ 199'],
  ['导入导出模板包', '统一导入导出协议与模板市场，覆盖常用业务单据场景。', '免费'],
] as const;

const updates = [
  ['1', '系统核心依赖与权限模块完成更新', 'FNA', '2026-08-14 10:20:00'],
  ['2', '新增多套可复用的业务插件与示例文件', '插件市场', '2026-08-13 16:42:00'],
  ['3', '补充从初始化到部署的完整操作说明', '文档中心', '2026-08-12 09:15:00'],
  ['4', '夜间主题与卡片边框模式细节对齐', '主题系统', '2026-08-11 21:08:00'],
  ['5', '仪表盘快捷入口与公告卡片结构优化', '前端', '2026-08-10 14:33:00'],
] as const;

const quickLinks = [
  { href: '/system/menus', label: '菜单管理', icon: Menu },
  { href: '/system/apis', label: 'API管理', icon: Link2 },
  { href: '/system/roles', label: '角色管理', icon: Shield },
  { href: '/system/users', label: '用户管理', icon: UserRound },
  { href: '/tools/auto-pkg', label: '自动化包', icon: Package },
  { href: '/tools/auto-code', label: '自动代码', icon: FileCode2 },
] as const;

const externalLinks = [
  { href: 'https://www.gin-vue-admin.com/', label: '授权购买', icon: BookOpen },
  { href: 'https://plugin.gin-vue-admin.com/', label: '插件市场', icon: FileText },
  { href: 'https://github.com/flipped-aurora/gin-vue-admin', label: '项目仓库', icon: Link2 },
] as const;

const notices = [
  {
    typeTitle: '通知',
    time: '今天',
    title: '购买商业授权后可进入专属技术支持通道，加快问题排查和版本升级效率。',
    tone: 'cyan',
  },
  {
    typeTitle: '活动',
    time: '2天前',
    title: '插件市场正在进行限时优惠活动，授权用户可获得更低的插件采购成本。',
    tone: 'emerald',
  },
  {
    typeTitle: '合规',
    time: '3天前',
    title: '未授权商用存在合规风险，建议团队尽快完成授权以保障项目持续交付。',
    tone: 'amber',
  },
  {
    typeTitle: '服务',
    time: '5天前',
    title: '授权用户可获得官方长期维护承诺，包含安全修复与关键版本升级支持。',
    tone: 'violet',
  },
] as const;

const docs = [
  { href: 'https://nextjs.org/docs', label: 'Next.js' },
  { href: 'https://gofiber.io/docs/', label: 'Fiber 文档' },
  { href: 'https://www.gin-vue-admin.com/', label: '参考文档' },
  { href: 'https://plugin.gin-vue-admin.com/', label: '插件市场' },
  { href: 'https://github.com/flipped-aurora/gin-vue-admin', label: 'GitHub 仓库' },
  { href: '/about', label: '关于 FNA' },
] as const;

const CONTENT_CHART_X = ['2024-1', '2024-2', '2024-3', '2024-4', '2024-5', '2024-6', '2024-7', '2024-8'] as const;
const CONTENT_CHART_Y = [12, 22, 32, 45, 32, 78, 89, 92] as const;
const CONTENT_CHART_Y_MAX = 100;
const CONTENT_CHART_VIEW_W = 900;
const CONTENT_CHART_VIEW_H = 220;

export function ReferenceDashboard() {
  const [today, setToday] = useState('—');

  useEffect(() => {
    try {
      setToday(
        new Date().toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
      );
    } catch {
      setToday(new Date().toISOString().slice(0, 10));
    }
  }, []);

  return (
    <div className="fnaSystemPage referenceDashboard">
      <section className="referenceWelcome">
        <div>
          <span className="referenceEyebrow">DASHBOARD</span>
          <h1>欢迎回来，开始今天的Coding节奏</h1>
          <p>{today} · 已为你聚合核心业务数据、插件动态和系统公告</p>
        </div>
        <div className="referenceWelcomeActions">
          <a
            href="https://plugin.gin-vue-admin.com/license"
            target="_blank"
            rel="noreferrer"
            className="primaryButton"
          >
            购买商业授权
          </a>
          <a
            href="https://plugin.gin-vue-admin.com"
            target="_blank"
            rel="noreferrer"
            className="secondaryButton"
          >
            插件市场
          </a>
        </div>
      </section>

      {/*
        统一三列网格：访问人数+新增客户(+间隔)=内容数据宽度；
        解决数量=右侧快捷栏宽度。对齐 GVA xl:grid-cols-3 + xl:col-span-8/4。
      */}
      <div className="referenceDashboardBody">
        {metrics.map((metric, index) => (
          <article
            key={metric.label}
            className={`referenceMetricCard referenceMetric-${index + 1}`}
          >
            <strong>{metric.label}</strong>
            {/* 迷你图只相对数值区定位，不含标题（对齐 GVA charts.vue） */}
            <div className="referenceMetricBody">
              <div className="referenceMetricValue">{metric.value}</div>
              <span className="referenceMetricDelta">
                {metric.delta} <ArrowUpRight size={13} />
              </span>
              <Sparkline series={metric.series} />
            </div>
          </article>
        ))}

        <div className="referenceDashboardMain">
          <section className="referencePanel referenceChartPanel">
            <ReferencePanelTitle title="内容数据" />
            <ContentChart />
          </section>

          <section className="referencePanel">
            <ReferencePanelTitle title="最新插件" />
            <div className="referenceTableWrap" role="region" aria-label="最新插件表格" tabIndex={0}>
              <table className="referenceTable referenceTableStriped">
                <thead>
                  <tr>
                    <th>插件标题</th>
                    <th>简介</th>
                    <th>价格</th>
                  </tr>
                </thead>
                <tbody>
                  {plugins.map(([title, description, price]) => (
                    <tr key={title}>
                      <td>
                        <strong>{title}</strong>
                      </td>
                      <td>{description}</td>
                      <td>{price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="referencePanel">
            <ReferencePanelTitle title="最新更新" />
            <div className="referenceTableWrap" role="region" aria-label="最新更新表格" tabIndex={0}>
              <table className="referenceTable referenceTableStriped">
                <thead>
                  <tr>
                    <th className="referenceTableRank">排名</th>
                    <th>更新内容</th>
                    <th>提交人</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {updates.map(([rank, message, author, date]) => (
                    <tr key={rank}>
                      <td className="referenceTableRank">{rank}</td>
                      <td>{message}</td>
                      <td>{author}</td>
                      <td>{date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="referenceDashboardRail">
          <section className="referencePanel referenceQuickPanel">
            <ReferencePanelTitle title="快捷功能" action="更多" />
            <span className="referenceRailLabel">常用入口</span>
            <div className="referenceQuickGrid">
              {quickLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.label} href={item.href} className="referenceQuickLink">
                    <span className="referenceQuickIcon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <span className="referenceRailLabel">常用外链</span>
            <div className="referenceExternalList">
              {externalLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="referenceExternalLink"
                  >
                    <span>
                      <Icon size={14} />
                      {item.label}
                    </span>
                    <small>打开</small>
                  </a>
                );
              })}
            </div>
          </section>

          <section className="referencePanel referenceNoticePanel">
            <ReferencePanelTitle title="公告" action="更多" />
            <div className="referenceNoticeList">
              {notices.map((notice) => (
                <article key={notice.typeTitle} className="referenceNotice">
                  <span className={`referenceNoticeDot tone-${notice.tone}`} aria-hidden="true" />
                  <div className="referenceNoticeBody">
                    <div className="referenceNoticeMeta">
                      <span className={`referenceNoticeTag tone-${notice.tone}`}>{notice.typeTitle}</span>
                      <time>{notice.time}</time>
                    </div>
                    <p>{notice.title}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="referencePanel referenceDocsPanel">
            <ReferencePanelTitle title="文档" action="更多" />
            <div className="referenceDocsGrid">
              {docs.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="referenceDocLink"
                  {...(item.href.startsWith('http')
                    ? { target: '_blank', rel: 'noreferrer' }
                    : {})}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </section>

          <section className="referenceLicenseCard">
            <span className="referenceLicenseBadge">商业授权</span>
            <h3>解锁完整商用支持与专属服务</h3>
            <p>
              购买授权后可获得专属支持通道、插件优惠与商用合规保障，帮助团队更稳定地推进项目交付。
            </p>
            <div className="referenceLicensePills">
              <span>专属技术支持</span>
              <span>插件优惠权益</span>
              <span>商用授权凭证</span>
            </div>
            <div className="referenceLicenseActions">
              <a
                href="https://plugin.gin-vue-admin.com/license"
                target="_blank"
                rel="noreferrer"
                className="primaryButton"
              >
                立即购买
              </a>
              <a
                href="https://plugin.gin-vue-admin.com"
                target="_blank"
                rel="noreferrer"
                className="referenceLicenseLink"
              >
                查看插件市场
              </a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ReferencePanelTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="referencePanelTitle">
      <h2>{title}</h2>
      {action ? (
        <Link href="/system/menus" className="referencePanelAction">
          {action}
        </Link>
      ) : null}
    </div>
  );
}

function buildSmoothPath(
  values: readonly number[],
  width: number,
  height: number,
  yMax: number,
) {
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 0 : (index / (values.length - 1)) * width,
    y: (1 - value / yMax) * height,
  }));

  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  const last = points[points.length - 1];
  const first = points[0];
  return {
    points,
    line: d,
    area: `${d} L${last.x.toFixed(2)} ${height} L${first.x.toFixed(2)} ${height} Z`,
  };
}

/** 对齐 GVA charts-people-numbers：右上角 w-1/2 h-20 */
function Sparkline({ series }: { series: readonly number[] }) {
  const uid = useId().replace(/:/g, '');
  const strokeId = `spark-stroke-${uid}`;
  const fillId = `spark-fill-${uid}`;
  const yMax = Math.max(...series, 1) * 1.15;
  const { line, area } = buildSmoothPath(series, 160, 64, yMax);

  return (
    <svg className="referenceSparkline" viewBox="0 0 160 64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.2" />
          <stop offset="50%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.39" />
          <stop offset="100%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.13" />
          <stop offset="100%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      <path d={line} className="referenceSparklinePath" stroke={`url(#${strokeId})`} fill="none" />
    </svg>
  );
}

/** 对齐 echarts 默认：优先落在指针右下方，越界则翻转并 confine 在画布内 */
function placeChartTooltip(
  mouseX: number,
  mouseY: number,
  viewW: number,
  viewH: number,
  tipW: number,
  tipH: number,
  gapX = 18,
  gapY = 28,
  /** 翻到鼠标上方时与指针的间距（更小 → 整体更靠下） */
  gapYAbove = 8,
) {
  let left = mouseX + gapX;
  let top = mouseY + gapY;
  if (left + tipW > viewW) {
    left = mouseX - tipW - gapX;
  }
  if (top + tipH > viewH) {
    top = mouseY - tipH - gapYAbove;
  }
  left = Math.min(Math.max(0, left), Math.max(0, viewW - tipW));
  top = Math.min(Math.max(0, top), Math.max(0, viewH - tipH));
  return { left, top };
}

/** 曲线上方留一点描边命中带，下方整块面积区都算曲线区域 */
const CHART_CURVE_STROKE_HIT_PX = 10;

/** 按鼠标 X 在相邻数据点间线性插值曲线 Y（像素） */
function curvePixelYAt(
  points: readonly { x: number; y: number }[],
  mouseX: number,
  viewW: number,
  canvasW: number,
  canvasH: number,
) {
  if (points.length === 0) {
    return canvasH;
  }
  if (points.length === 1) {
    return (points[0].y / CONTENT_CHART_VIEW_H) * canvasH;
  }
  const xInView = (mouseX / canvasW) * viewW;
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x < xInView) {
    i += 1;
  }
  const a = points[i];
  const b = points[i + 1];
  const t = b.x === a.x ? 0 : (xInView - a.x) / (b.x - a.x);
  const yInView = a.y + (b.y - a.y) * Math.min(1, Math.max(0, t));
  return (yInView / CONTENT_CHART_VIEW_H) * canvasH;
}

function ContentChart() {
  const uid = useId().replace(/:/g, '');
  const strokeId = `chart-stroke-${uid}`;
  const fillId = `chart-fill-${uid}`;
  const clipId = `chart-clip-${uid}`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    index: number;
    /** 吸附到数据点的坐标（viewBox） */
    pointX: number;
    pointY: number;
    /** tooltip 左上角相对画布的像素位置（已 confine） */
    tipLeft: number;
    tipTop: number;
    /** 鼠标是否在曲线/面积区域内（控制手型光标） */
    onCurve: boolean;
  } | null>(null);

  const { points, line, area } = useMemo(
    () => buildSmoothPath(CONTENT_CHART_Y, CONTENT_CHART_VIEW_W, CONTENT_CHART_VIEW_H, CONTENT_CHART_Y_MAX),
    [],
  );
  const yTicks = [100, 80, 60, 40, 20, 0] as const;

  function updateHover(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const mouseX = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const mouseY = Math.min(rect.height, Math.max(0, clientY - rect.top));
    const ratioX = mouseX / rect.width;
    const index = Math.round(ratioX * (points.length - 1));
    const point = points[index];
    const curveY = curvePixelYAt(points, mouseX, CONTENT_CHART_VIEW_W, rect.width, rect.height);
    // 曲线描边附近 + 曲线下方填充区 → 手型；其余空白为箭头
    const onCurve = mouseY >= curveY - CHART_CURVE_STROKE_HIT_PX && mouseY <= rect.height;
    const tipEl = tooltipRef.current;
    const tipW = tipEl?.offsetWidth || 180;
    const tipH = tipEl?.offsetHeight || 72;
    const { left: tipLeft, top: tipTop } = placeChartTooltip(
      mouseX,
      mouseY,
      rect.width,
      rect.height,
      tipW,
      tipH,
    );
    setHover({
      index,
      pointX: point.x,
      pointY: point.y,
      tipLeft,
      tipTop,
      onCurve,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) {
    updateHover(event.clientX, event.clientY);
  }

  function clearHover() {
    setHover(null);
  }

  const active = Boolean(hover);
  const onCurve = Boolean(hover?.onCurve);
  const pointLeft = hover ? `${(hover.pointX / CONTENT_CHART_VIEW_W) * 100}%` : '0%';
  const pointTop = hover ? `${(hover.pointY / CONTENT_CHART_VIEW_H) * 100}%` : '0%';
  const tooltipLeft = hover ? `${hover.tipLeft}px` : '0px';
  const tooltipTop = hover ? `${hover.tipTop}px` : '0px';
  const tooltipLabel = hover ? CONTENT_CHART_X[hover.index] : '';
  const tooltipValue = hover
    ? (Number(CONTENT_CHART_Y[hover.index]) * 10000).toLocaleString()
    : '';

  return (
    <div className="referenceContentChart">
      <div className="referenceChartYAxis" aria-hidden="true">
        {yTicks.map((tick, index) => (
          <span
            key={tick}
            style={{ top: `${(index / (yTicks.length - 1)) * 100}%` }}
          >
            {tick === 0 ? '0' : `${tick}k`}
          </span>
        ))}
      </div>

      <div className="referenceChartPlot">
        <div
          ref={canvasRef}
          className={`referenceChartCanvas${active ? ' is-active' : ''}${onCurve ? ' is-on-curve' : ''}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={clearHover}
          onMouseMove={handlePointerMove}
          onMouseLeave={clearHover}
        >
          <svg
            className="referenceContentChartSvg"
            viewBox={`0 0 ${CONTENT_CHART_VIEW_W} ${CONTENT_CHART_VIEW_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Content data trend"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width={CONTENT_CHART_VIEW_W} height={CONTENT_CHART_VIEW_H} />
              </clipPath>
              <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.5" />
                <stop offset="50%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.57" />
                <stop offset="100%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="1" />
              </linearGradient>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.13" />
                <stop offset="100%" stopColor="var(--el-color-primary, #2264f2)" stopOpacity="0.03" />
              </linearGradient>
            </defs>

            <g clipPath={`url(#${clipId})`}>
              {yTicks.map((tick, index) => {
                const y = (index / (yTicks.length - 1)) * CONTENT_CHART_VIEW_H;
                return (
                  <line
                    key={`h-${tick}`}
                    className="referenceChartGridLine"
                    x1={0}
                    y1={y}
                    x2={CONTENT_CHART_VIEW_W}
                    y2={y}
                  />
                );
              })}

              {CONTENT_CHART_X.map((label, index) => {
                if (index === 0 || index === CONTENT_CHART_X.length - 1) {
                  return null;
                }
                const x = (index / (CONTENT_CHART_X.length - 1)) * CONTENT_CHART_VIEW_W;
                return (
                  <line
                    key={`v-${label}`}
                    className="referenceChartGridLine"
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={CONTENT_CHART_VIEW_H}
                  />
                );
              })}

              <path d={area} fill={`url(#${fillId})`} />
              <path d={line} stroke={`url(#${strokeId})`} className="referenceChartPath" fill="none" />
            </g>
          </svg>

          {/* HTML 覆盖层：指示线 / 锚点 / tooltip 可用 CSS transition 平滑跟随 */}
          <div
            className="referenceChartPointer"
            style={{ left: pointLeft, opacity: active ? 1 : 0 }}
            aria-hidden="true"
          />
          <div
            className="referenceChartDot"
            style={{ left: pointLeft, top: pointTop, opacity: active ? 1 : 0 }}
            aria-hidden="true"
          />
          <div
            ref={tooltipRef}
            className="echarts-tooltip-diy referenceChartTooltip"
            style={{
              left: tooltipLeft,
              top: tooltipTop,
              opacity: active ? 1 : 0,
              visibility: active ? 'visible' : 'hidden',
            }}
            aria-hidden={!active}
          >
            <p className="tooltip-title">{tooltipLabel}</p>
            <div className="content-panel">
              <span>总内容量</span>
              <span className="tooltip-value">{tooltipValue}</span>
            </div>
          </div>
        </div>

        <div className="referenceChartLabels" aria-hidden="true">
          {CONTENT_CHART_X.map((label, index) => {
            const hidden = index === 0 || index === CONTENT_CHART_X.length - 1;
            return (
              <span
                key={label}
                className={hidden ? 'is-hidden' : undefined}
                style={{ left: `${(index / (CONTENT_CHART_X.length - 1)) * 100}%` }}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
