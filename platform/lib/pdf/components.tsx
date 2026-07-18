import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { brand } from "@/lib/brand";
import { formatDateTimeInTz } from "@/lib/datetime";

// Shared React-PDF building blocks (§6, §7, T017). SERVER-ONLY — imported by the
// api/pdf route handler, never a client component. Constitution IX: the product
// name/domain/footer all come from lib/brand (no hardcoded name). Constitution
// VII: every rendered time flows through lib/datetime in the program timezone.
// Built-in Helvetica only — no network font fetches.

export const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 8,
    marginBottom: 16,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brandName: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 6 },
  subtitle: { fontSize: 11, color: "#374151", marginTop: 2 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#9ca3af",
    paddingBottom: 3,
  },
  row: { flexDirection: "row", alignItems: "center" },
  muted: { color: "#6b7280" },
  bold: { fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: "#9ca3af",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#6b7280",
  },
  checkboxCol: { width: 42, textAlign: "center" },
  checkbox: {
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: "#374151",
    alignSelf: "center",
  },
  tableHeadRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 3,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    minHeight: 18,
  },
});

export function BrandHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Text style={styles.brandName}>{brand.name.toUpperCase()}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// Footer: brand + domain + generated-at (program tz) on the left, page x/y on the
// right. `fixed` repeats it on every page.
export function BrandFooter({
  tz,
  note,
}: {
  tz: string;
  note?: string;
}) {
  const generated = formatDateTimeInTz(new Date(), tz);
  return (
    <View style={styles.footer} fixed>
      <Text>
        {note ? `${note}  ·  ` : ""}
        {brand.name} · {brand.domain} · generated {generated}
      </Text>
      <Text
        render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `${pageNumber} / ${totalPages}`
        }
      />
    </View>
  );
}

// A fresh document Page with the standard chrome. Children are the body.
export function DocPage({
  tz,
  footerNote,
  children,
}: {
  tz: string;
  footerNote?: string;
  children: React.ReactNode;
}) {
  return (
    <Page size="LETTER" style={styles.page}>
      {children}
      <BrandFooter tz={tz} note={footerNote} />
    </Page>
  );
}

export { Document, Page, View, Text };
