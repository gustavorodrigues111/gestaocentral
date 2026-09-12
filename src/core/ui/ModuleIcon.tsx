// Ícone central dos módulos. Resolve um nome do lucide (kebab-case, ex:
// "calendar-check") no componente correspondente. Se o nome não estiver no
// registro (ex: um emoji legado "🎫"), cai no fallback e renderiza o texto —
// assim nada quebra durante a migração emoji → lucide.
//
// Mesmo componente usado no Menu lateral, no grid de Módulos e em Perfis de
// Acesso, garantindo que o ícone seja idêntico nos três lugares.
import {
  // Minhas Informações
  LayoutDashboard, CalendarDays, Clock, HandCoins, Megaphone, MessageCircle,
  // Operação
  CalendarCheck, PartyPopper, MessagesSquare, ListChecks, Boxes, PackageCheck,
  Wallet, ClipboardList, TriangleAlert, Lightbulb, Presentation, UserPlus,
  CalendarClock, ShieldCheck, Globe, BookOpen, Store,
  // Pessoas & DP
  Users, FileText, UserSearch, UserRoundPlus, UserRoundMinus, Route, Send,
  CalendarRange, Fingerprint, ChartColumn, Gift, Coins, ReceiptText,
  Stethoscope, Shirt,
  // Administrativo
  ListTodo, AlarmClock, Calculator, ShoppingCart, BookMarked, Repeat, KeyRound,
  Receipt, ChartLine, CreditCard, Bot,
  // Configurações
  Building2, LayoutGrid, UserRoundCog, Plug,
  // Master
  ShieldAlert, FileSignature, NotebookPen,
  // Categorias / subáreas
  ChefHat, Briefcase, Settings, House, Crown,
  type LucideIcon,
} from "lucide-react";

const REGISTRY: Record<string, LucideIcon> = {
  // Minhas Informações
  "layout-dashboard": LayoutDashboard, "calendar-days": CalendarDays,
  "clock": Clock, "hand-coins": HandCoins, "megaphone": Megaphone,
  "message-circle": MessageCircle,
  // Operação
  "calendar-check": CalendarCheck, "party-popper": PartyPopper,
  "messages-square": MessagesSquare, "list-checks": ListChecks, "boxes": Boxes,
  "package-check": PackageCheck, "wallet": Wallet, "clipboard-list": ClipboardList,
  "triangle-alert": TriangleAlert, "lightbulb": Lightbulb,
  "presentation": Presentation, "user-plus": UserPlus,
  "calendar-clock": CalendarClock, "shield-check": ShieldCheck, "globe": Globe,
  "book-open": BookOpen, "store": Store,
  // Pessoas & DP
  "users": Users, "file-text": FileText, "user-search": UserSearch,
  "user-round-plus": UserRoundPlus, "user-round-minus": UserRoundMinus,
  "route": Route, "send": Send, "calendar-range": CalendarRange,
  "fingerprint": Fingerprint, "chart-column": ChartColumn, "gift": Gift,
  "coins": Coins, "receipt-text": ReceiptText, "stethoscope": Stethoscope,
  "shirt": Shirt,
  // Administrativo
  "list-todo": ListTodo, "alarm-clock": AlarmClock, "calculator": Calculator,
  "shopping-cart": ShoppingCart, "book-marked": BookMarked, "repeat": Repeat,
  "key-round": KeyRound, "receipt": Receipt, "chart-line": ChartLine,
  "credit-card": CreditCard, "bot": Bot,
  // Configurações
  "building-2": Building2, "layout-grid": LayoutGrid,
  "user-round-cog": UserRoundCog, "plug": Plug,
  // Master
  "shield-alert": ShieldAlert, "file-signature": FileSignature,
  "notebook-pen": NotebookPen,
  // Categorias / subáreas
  "chef-hat": ChefHat, "briefcase": Briefcase, "settings": Settings,
  "house": House, "crown": Crown,
};

/** true se `name` é um nome lucide registrado (não um emoji legado). */
export function isLucideIcon(name: string | undefined | null): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

type Props = {
  name: string | undefined | null;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

/**
 * Renderiza o ícone de um módulo. `name` pode ser:
 *  - um nome lucide kebab-case ("calendar-check") → SVG (herda currentColor)
 *  - um emoji legado ("🎫") → renderizado como texto (fallback)
 */
export function ModuleIcon({ name, size = 18, className, strokeWidth = 2 }: Props) {
  const Cmp = name ? REGISTRY[name] : undefined;
  if (Cmp) {
    return <Cmp size={size} className={className} strokeWidth={strokeWidth} aria-hidden />;
  }
  // Fallback: emoji ou string desconhecida
  return (
    <span className={className} style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
      {name || "•"}
    </span>
  );
}
