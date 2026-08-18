'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Code2,
  ExternalLink,
  FileText,
  Link2,
  Menu,
  UserRound,
} from 'lucide-react';

const metrics = [
  { label: '访问人数', value: '268,500', delta: '+80%', path: 'M2 32 C24 29 38 28 58 24 S93 28 106 14 S137 5 158 4' },
  { label: '新增客户', value: '268,500', delta: '+80%', path: 'M2 35 C28 35 34 37 48 24 S65 40 82 18 S112 14 126 9 S148 11 158 35' },
  { label: '解决数量', value: '268,500', delta: '+80%', path: 'M2 34 C28 30 43 28 61 24 S92 28 105 14 S137 5 158 4' },
] as const;

const plugins = [
  ['[BBS] 极光论坛--基于G...', '面向 gin-vue-admin 的论坛社区插件，提供版块、用户、帖子、评论、经验体系。', '¥ 3688'],
  ['[gvaClaw] 适配GVA的...', '适配 Gin-Vue-Admin 的多端兼容 claw，为内嵌的管理后台提供 Web 管理能力。', '¥ 599'],
  ['Gin-Vue-Admin 开发者...', '围绕权限、菜单和接口快速生成后台代码，减少重复的基础配置工作。', '¥ 299'],
] as const;

const updates = [
  ['Gin-Vue-Admin', '系统核心依赖与权限模块完成更新', '2026/08/14'],
  ['插件市场', '新增多套可复用的业务插件与示例文件', '2026/08/13'],
  ['文档中心', '补充从初始化到部署的完整操作说明', '2026/08/12'],
] as const;

const quickLinks = [
  { href: '/settings', label: '菜单管理', icon: Menu },
  { href: '/integrations', label: 'API管理', icon: Link2 },
  { href: '/roles', label: '角色管理', icon: UserRound },
  { href: '/users', label: '用户管理', icon: UserRound },
  { href: '/services', label: '自动化包', icon: Boxes },
  { href: '/projects', label: '自动代码', icon: Code2 },
] as const;

const externalLinks = [
  { href: '/settings', label: '授权购买', icon: BookOpen },
  { href: '/integrations', label: '插件市场', icon: FileText },
  { href: '/projects', label: '项目仓库', icon: Link2 },
] as const;

export function ReferenceDashboard() {
  return (
    <main className="referenceDashboard">
      <section className="referenceWelcome">
        <div>
          <span className="referenceEyebrow">DASHBOARD</span>
          <h1>欢迎回来，开始今天的Coding节奏</h1>
          <p>2026/08/14 · 已为你聚合核心业务数据、插件动态和系统公告</p>
        </div>
        <div className="referenceWelcomeActions">
          <Link href="/settings" className="primaryButton">购买商业授权</Link>
          <Link href="/integrations" className="secondaryButton">插件市场</Link>
        </div>
      </section>

      <section className="referenceMetricGrid" aria-label="Dashboard metrics">
        {metrics.map((metric) => (
          <article key={metric.label} className="referenceMetricCard">
            <strong>{metric.label}</strong>
            <div className="referenceMetricValue">{metric.value}</div>
            <span>{metric.delta} <ArrowUpRight size={13} /></span>
            <Sparkline path={metric.path} />
          </article>
        ))}
      </section>

      <div className="referenceDashboardColumns">
        <div className="referenceDashboardMain">
          <section className="referencePanel referenceChartPanel">
            <ReferencePanelTitle title="内容数据" />
            <ContentChart />
          </section>

          <section className="referencePanel">
            <ReferencePanelTitle title="最新插件" />
            <div className="referenceTableWrap" role="region" aria-label="最新插件表格" tabIndex={0}>
              <table className="referenceTable">
                <thead>
                  <tr><th>插件标题</th><th>简介</th><th>价格</th></tr>
                </thead>
                <tbody>
                  {plugins.map(([title, description, price]) => (
                    <tr key={title}><td><strong>{title}</strong></td><td>{description}</td><td>{price}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="referencePanel">
            <ReferencePanelTitle title="最新更新" />
            <div className="referenceTableWrap" role="region" aria-label="最新更新表格" tabIndex={0}>
              <table className="referenceTable">
                <thead>
                  <tr><th>项目</th><th>更新内容</th><th>更新时间</th></tr>
                </thead>
                <tbody>
                  {updates.map(([name, description, date]) => (
                    <tr key={name}><td><strong>{name}</strong></td><td>{description}</td><td>{date}</td></tr>
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

                return <Link key={item.label} href={item.href} className="referenceQuickLink"><Icon size={15} /><span>{item.label}</span></Link>;
              })}
            </div>
            <span className="referenceRailLabel">常用外链</span>
            <div className="referenceExternalList">
              {externalLinks.map((item) => {
                const Icon = item.icon;

                return <Link key={item.label} href={item.href} className="referenceExternalLink"><span><Icon size={14} />{item.label}</span><small>打开</small></Link>;
              })}
            </div>
          </section>

          <section className="referencePanel referenceNoticePanel">
            <ReferencePanelTitle title="公告" action="更多" />
            {['购买商业授权后可进入专属技术支持通道，加快问题排查和版本升级效率。', '插件市场正在进行限时优惠活动，授权用户可获得更低的插件采购成本。', '未授权商用存在合规风险，建议团队尽快完成授权。'].map((notice, index) => (
              <article key={notice} className="referenceNotice"><span className={`referenceNoticeDot tone-${index}`} /><div><span>{index === 0 ? '通知' : index === 1 ? '活动' : '合规'}</span><p>{notice}</p></div><time>{index === 0 ? '今天' : `${index + 1}天前`}</time></article>
            ))}
          </section>

          <section className="referencePanel referenceDocsPanel">
            <ReferencePanelTitle title="文档" action="更多" />
            <Link href="/settings" className="referenceDocLink"><BookOpen size={15} /><span>快速开始指南</span><ExternalLink size={13} /></Link>
            <Link href="/integrations" className="referenceDocLink"><FileText size={15} /><span>开发与部署文档</span><ExternalLink size={13} /></Link>
          </section>

          <section className="referenceLicenseCard">
            <span>商业授权</span>
            <h3>解锁完整商用支持与专属服务</h3>
            <p>为团队提供更稳定的项目交付、插件权益与技术支持。</p>
            <Link href="/settings" className="primaryButton">立即购买</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}

function ReferencePanelTitle({ title, action }: { title: string; action?: string }) {
  return <div className="referencePanelTitle"><h2>{title}</h2>{action ? <Link href="/settings">{action}</Link> : null}</div>;
}

function Sparkline({ path }: { path: string }) {
  return <svg className="referenceSparkline" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true"><path d="M2 38H158" className="referenceSparklineBase" /><path d={path} className="referenceSparklinePath" /></svg>;
}

function ContentChart() {
  return <div className="referenceContentChart"><div className="referenceChartGrid"><span>100k</span><span>80k</span><span>60k</span><span>40k</span><span>20k</span><span>0</span></div><svg viewBox="0 0 900 220" preserveAspectRatio="none" role="img" aria-label="Content data trend"><path d="M0 198 C98 176 155 169 210 153 S343 128 397 149 S496 180 551 144 S620 81 702 68 S797 58 900 54 L900 220 L0 220 Z" className="referenceChartArea" /><path d="M0 198 C98 176 155 169 210 153 S343 128 397 149 S496 180 551 144 S620 81 702 68 S797 58 900 54" className="referenceChartPath" /></svg><div className="referenceChartLabels"><span>2024-2</span><span>2024-3</span><span>2024-4</span><span>2024-5</span><span>2024-6</span><span>2024-7</span></div></div>;
}
