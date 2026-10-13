export type Milestone = { views: number; payout: number };
export function calculatePayout(views: number, milestones: Milestone[]): number {
  return milestones.filter(m => views >= m.views).reduce((best, m) => m.views > best.views ? m : best, { views: 0, payout: 0 }).payout;
}
export function budgetCappedPayout(targetPayout: number, alreadyPaid: number, remainingBudget: number): number {
  return Math.max(0, Math.min(targetPayout - alreadyPaid, remainingBudget));
}
