// Role + department metadata shared across the app
import {
  Crown, ShieldCheck, UserCog, Users, User, Eye,
  UsersRound, CalendarDays, Clapperboard, Wallet, Wrench,
} from 'lucide-react';

export const ROLE_LABELS = {
  professor: 'Professor',
  leader: 'Leader',
  coleader: 'Co-Leader',
  manager: 'Manager',
  member: 'Member',
  guest: 'Guest',
};

export const ROLE_COLORS = {
  professor: 'var(--role-professor)',
  leader: 'var(--role-leader)',
  coleader: 'var(--role-coleader)',
  manager: 'var(--role-manager)',
  member: 'var(--role-member)',
  guest: 'var(--role-guest)',
};

// compact icon per role (for pills / lists)
export const ROLE_ICONS = {
  professor: Eye,
  leader: Crown,
  coleader: ShieldCheck,
  manager: UserCog,
  member: Users,
  guest: User,
};

export const isBoss = (role) => ['professor', 'leader', 'coleader'].includes(role);
// management powers (roles, departments, removal) — Professor is read-only
export const isLeader = (role) => ['leader', 'coleader'].includes(role);

// ---------- Departments ----------
export const DEPT_ICONS = {
  hr: UsersRound,
  events: CalendarDays,
  media: Clapperboard,
  finance: Wallet,
  materials: Wrench,
};

export const DEPT_LABELS = {
  hr: 'Human Resources',
  events: 'Events',
  media: 'Media',
  finance: 'Finance',
  materials: 'Materials',
};
