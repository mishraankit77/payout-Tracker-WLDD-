import { calculatePayout, budgetCappedPayout } from '../payout';
const ladder = [{ views: 10000, payout: 500 }, { views: 50000, payout: 2000 }, { views: 100000, payout: 5000 }];
describe('calculatePayout', () => {
  it('pays the highest crossed milestone', () => { expect(calculatePayout(74999, ladder)).toBe(2000); });
  it('returns zero below the first milestone', () => { expect(calculatePayout(9999, ladder)).toBe(0); });
  it('handles thresholds in any input order', () => { expect(calculatePayout(100000, [...ladder].reverse())).toBe(5000); });
});
describe('budgetCappedPayout', () => {
  it('never pays more than remaining campaign budget', () => { expect(budgetCappedPayout(5000, 0, 1200)).toBe(1200); });
  it('pays only the difference on repeated view updates', () => { expect(budgetCappedPayout(2000, 500, 5000)).toBe(1500); });
  it('never makes a negative payment', () => { expect(budgetCappedPayout(500, 2000, 100)).toBe(0); });
});
