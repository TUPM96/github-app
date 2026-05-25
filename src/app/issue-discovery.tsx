"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

export interface DiscoveryIssue {
  id: string;
  title: string;
  repositoryName: string;
  issueNumber: number;
  issueUrl: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  excerpt: string | null;
  labelName: string;
}

type ViewMode = "recent" | "top";

export default function IssueDiscovery({
  initialIssues,
}: {
  initialIssues: DiscoveryIssue[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("recent");
  const [minimumBounty, setMinimumBounty] = useState("");

  const minimumAmount = Number.parseFloat(minimumBounty);
  const filteredIssues = useMemo(() => {
    const hasThreshold = Number.isFinite(minimumAmount);
    const threshold = hasThreshold ? minimumAmount : 0;

    return [...initialIssues]
      .filter((issue) => !hasThreshold || issue.amount > threshold)
      .sort((left, right) => {
        if (viewMode === "top") {
          return right.amount - left.amount;
        }

        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      });
  }, [initialIssues, minimumAmount, viewMode]);

  const openCount = initialIssues.filter(
    (issue) => issue.status.toLowerCase() === "open",
  ).length;
  const totalBounty = initialIssues.reduce(
    (total, issue) => total + issue.amount,
    0,
  );
  const currencies = new Set(initialIssues.map((issue) => issue.currency));
  const totalCurrency =
    currencies.size === 1 ? initialIssues[0]?.currency ?? "USDC" : "mixed";

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <a href="https://pvium.com" style={styles.logoLink}>
          <img
            alt="Pvium logo"
            src="/assets/logo-512v2.PNG"
            style={styles.logo}
          />
          <span style={styles.brand}>Pvium Bounties</span>
        </a>
        <nav style={styles.nav}>
          <a href="/deploy" style={styles.navLink}>
            Deploy
          </a>
          <a
            href="https://github.com/apps/pvium-bounty-app"
            rel="noreferrer"
            style={styles.primaryLink}
            target="_blank"
          >
            Install App
          </a>
        </nav>
      </header>

      <section style={styles.summaryBand}>
        <div>
          <p style={styles.eyebrow}>Issue Discovery</p>
          <h1 style={styles.title}>Bounty Issues</h1>
        </div>
        <div style={styles.statsGrid}>
          <Stat label="Tracked" value={String(initialIssues.length)} />
          <Stat label="Open" value={String(openCount)} />
          <Stat label="Total" value={formatBounty(totalBounty, totalCurrency)} />
        </div>
      </section>

      <section style={styles.toolbar} aria-label="Issue controls">
        <div style={styles.tabs} role="tablist" aria-label="Issue views">
          <TabButton
            active={viewMode === "recent"}
            label="Recent Issues"
            onClick={() => setViewMode("recent")}
          />
          <TabButton
            active={viewMode === "top"}
            label="Top Issues"
            onClick={() => setViewMode("top")}
          />
        </div>
        <label style={styles.filterLabel}>
          <span style={styles.filterText}>Bounty &gt;</span>
          <input
            min="0"
            inputMode="decimal"
            onChange={(event) => setMinimumBounty(event.target.value)}
            placeholder="0"
            style={styles.input}
            type="number"
            value={minimumBounty}
          />
        </label>
      </section>

      <section style={styles.issueList} aria-live="polite">
        {filteredIssues.length > 0 ? (
          filteredIssues.map((issue) => (
            <IssueCard issue={issue} key={issue.id} />
          ))
        ) : (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>No matching bounty issues</h2>
            <p style={styles.emptyText}>
              Connected repositories will appear here after maintainers label
              issues with a Pvium bounty label.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      onClick={onClick}
      role="tab"
      style={active ? { ...styles.tab, ...styles.activeTab } : styles.tab}
      type="button"
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <strong style={styles.statValue}>{value}</strong>
    </div>
  );
}

function IssueCard({ issue }: { issue: DiscoveryIssue }) {
  return (
    <a
      href={issue.issueUrl}
      rel="noreferrer"
      style={styles.issueCard}
      target="_blank"
    >
      <div style={styles.issueMain}>
        <div style={styles.issueTopline}>
          <span style={styles.repositoryName}>{issue.repositoryName}</span>
          <span style={getStatusStyle(issue.status)}>
            {formatStatus(issue.status)}
          </span>
        </div>
        <h2 style={styles.issueTitle}>{issue.title}</h2>
        {issue.excerpt ? <p style={styles.excerpt}>{issue.excerpt}</p> : null}
        <div style={styles.issueMeta}>
          <span>#{issue.issueNumber}</span>
          <span>{issue.labelName}</span>
          <span>Updated {formatDate(issue.updatedAt)}</span>
          <span>Created {formatDate(issue.createdAt)}</span>
        </div>
      </div>
      <div style={styles.amountBlock}>
        <span style={styles.amount}>
          {formatBounty(issue.amount, issue.currency)}
        </span>
        <span style={styles.amountLabel}>Bounty</span>
      </div>
    </a>
  );
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").toLowerCase();
}

function getStatusStyle(status: string): CSSProperties {
  const normalized = status.toLowerCase();
  const statusColor =
    normalized === "open"
      ? styles.openStatus
      : normalized === "paid"
        ? styles.paidStatus
        : normalized === "closed"
          ? styles.closedStatus
          : styles.neutralStatus;

  return { ...styles.status, ...statusColor };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatBounty(amount: number, currency: string) {
  const formattedAmount = new Intl.NumberFormat("en", {
    maximumFractionDigits: 6,
  }).format(amount);

  return `${formattedAmount} ${currency}`;
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "28px 20px 48px",
    background: "#f5f7fb",
    color: "#152238",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto 28px",
  },
  logoLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    color: "#152238",
    fontWeight: 800,
    textDecoration: "none",
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    objectFit: "contain",
  },
  brand: {
    fontSize: 16,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
  },
  navLink: {
    color: "#2f405c",
    fontSize: 14,
    fontWeight: 700,
    textDecoration: "none",
  },
  primaryLink: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 40,
    padding: "0 14px",
    borderRadius: 8,
    background: "#172033",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none",
  },
  summaryBand: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    alignItems: "end",
    gap: 20,
    maxWidth: 1120,
    margin: "0 auto 18px",
    padding: "4px 0 18px",
    borderBottom: "1px solid #d9deea",
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#607089",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: "#111827",
    fontSize: 44,
    lineHeight: 1.12,
    letterSpacing: 0,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
    gap: 10,
  },
  stat: {
    minWidth: 0,
    padding: 14,
    border: "1px solid #d9deea",
    borderRadius: 8,
    background: "#ffffff",
  },
  statLabel: {
    display: "block",
    marginBottom: 4,
    color: "#68778f",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  statValue: {
    display: "block",
    overflow: "hidden",
    color: "#152238",
    fontSize: 18,
    lineHeight: 1.2,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 14,
    maxWidth: 1120,
    margin: "0 auto 16px",
  },
  tabs: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 4,
    border: "1px solid #d6ddeb",
    borderRadius: 8,
    background: "#ffffff",
  },
  tab: {
    minHeight: 36,
    padding: "0 12px",
    border: 0,
    borderRadius: 6,
    background: "transparent",
    color: "#42516a",
    cursor: "pointer",
    font: "inherit",
    fontSize: 14,
    fontWeight: 800,
  },
  activeTab: {
    background: "#e8f2ff",
    color: "#0f4d8f",
  },
  filterLabel: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 44,
    padding: "0 10px 0 12px",
    border: "1px solid #d6ddeb",
    borderRadius: 8,
    background: "#ffffff",
  },
  filterText: {
    marginRight: 8,
    color: "#42516a",
    fontSize: 14,
    fontWeight: 800,
  },
  input: {
    width: 96,
    minHeight: 32,
    border: "1px solid #c9d2e1",
    borderRadius: 6,
    color: "#152238",
    font: "inherit",
    fontSize: 14,
    padding: "0 8px",
  },
  issueList: {
    display: "grid",
    gap: 10,
    maxWidth: 1120,
    margin: "0 auto",
  },
  issueCard: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 18,
    minHeight: 150,
    padding: 18,
    border: "1px solid #d9deea",
    borderRadius: 8,
    background: "#ffffff",
    color: "#152238",
    textDecoration: "none",
  },
  issueMain: {
    minWidth: 0,
  },
  issueTopline: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  repositoryName: {
    color: "#315f8f",
    fontSize: 13,
    fontWeight: 800,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    padding: "0 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "capitalize",
  },
  openStatus: {
    background: "#e8f7ef",
    color: "#137647",
  },
  paidStatus: {
    background: "#eef2ff",
    color: "#3949ab",
  },
  closedStatus: {
    background: "#f2f4f7",
    color: "#596579",
  },
  neutralStatus: {
    background: "#fff7e6",
    color: "#8a5a00",
  },
  issueTitle: {
    margin: "0 0 8px",
    color: "#111827",
    fontSize: 20,
    lineHeight: 1.3,
    letterSpacing: 0,
  },
  excerpt: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    margin: "0 0 12px",
    color: "#52627a",
    fontSize: 14,
    lineHeight: 1.55,
  },
  issueMeta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px 12px",
    color: "#68778f",
    fontSize: 13,
    fontWeight: 700,
  },
  amountBlock: {
    alignSelf: "stretch",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 0,
    paddingLeft: 18,
    borderLeft: "1px solid #e2e7f0",
    textAlign: "right",
  },
  amount: {
    color: "#116149",
    fontSize: 24,
    fontWeight: 900,
    lineHeight: 1.1,
    wordBreak: "break-word",
  },
  amountLabel: {
    marginTop: 6,
    color: "#68778f",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  emptyState: {
    padding: "44px 22px",
    border: "1px solid #d9deea",
    borderRadius: 8,
    background: "#ffffff",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 8px",
    color: "#111827",
    fontSize: 22,
    letterSpacing: 0,
  },
  emptyText: {
    maxWidth: 520,
    margin: "0 auto",
    color: "#52627a",
    fontSize: 15,
    lineHeight: 1.6,
  },
};
