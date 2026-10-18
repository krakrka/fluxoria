"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CircleHelp,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Search,
  CreditCard,
  Settings,
  Cable,
  Shield,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Workflow,
} from "lucide-react";
import { can, type MemberRole, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const primary: Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission?: Permission }> = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/attention", label: "À traiter", icon: ClipboardList },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/invoices", label: "Factures", icon: Receipt, permission: "invoices.read" },
  { href: "/suppliers", label: "Fournisseurs", icon: Truck },
  { href: "/customers", label: "Clients", icon: Users },
  { href: "/orders", label: "Bons de commande", icon: ShoppingCart, permission: "orders.read" },
  { href: "/anomalies", label: "Anomalies", icon: AlertTriangle, permission: "invoices.read" },
  { href: "/approvals", label: "Approbations", icon: ScrollText, permission: "invoices.read" },
  { href: "/automations", label: "Automatisations", icon: Workflow, permission: "rules.read" },
  { href: "/roi", label: "ROI", icon: Sparkles, permission: "reports.read" },
  { href: "/search", label: "Recherche", icon: Search },
  { href: "/inbox", label: "Boîte de réception", icon: Inbox },
  { href: "/imports", label: "Imports", icon: FileText },
  { href: "/sources", label: "Sources", icon: Cable, permission: "connectors.manage" },
];

const secondary: Array<{ href: string; label: string; icon: typeof Settings; permission?: Permission }> = [
  { href: "/parcours", label: "Parcours", icon: ClipboardList },
  { href: "/help", label: "Aide", icon: CircleHelp },
  { href: "/support", label: "Support", icon: CircleHelp },
  { href: "/billing", label: "Facturation", icon: CreditCard, permission: "billing.manage" },
  { href: "/settings#organisation", label: "Organisation", icon: Settings, permission: "org.read" },
  { href: "/settings#membres", label: "Membres", icon: Users, permission: "members.manage" },
  { href: "/settings#securite", label: "Sécurité", icon: Shield, permission: "org.read" },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/audit", label: "Journal", icon: ScrollText, permission: "audit.read" },
  { href: "/admin/system", label: "Système", icon: Shield, permission: "system.read" },
];

export function SideNav({ role }: { role: MemberRole }) {
  const pathname = usePathname();
  const groups = [primary, secondary];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:block lg:space-y-4 lg:px-3">
      {groups.map((group, index) => (
        <div key={index} className="flex gap-1 lg:block lg:space-y-1">
          {group.filter((link) => !link.permission || can(role, link.permission)).map((link) => {
            const Icon = link.icon;
            const path = link.href.split("#")[0];
            const active = pathname === path || pathname.startsWith(`${path}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
                  active ? "bg-background font-medium text-foreground" : "text-muted hover:bg-background hover:text-foreground",
                )}
              >
                <Icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
