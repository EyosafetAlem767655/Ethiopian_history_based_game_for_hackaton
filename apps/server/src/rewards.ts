export interface LunchRewardProvider {
  claim(passId: string): Promise<{ redeemable: boolean; offerUrl?: string; disclaimer: string }>;
}
export class PrototypeLunchProvider implements LunchRewardProvider {
  async claim() {
    return {
      redeemable: false,
      disclaimer:
        'Prototype Royal Lunch Pass — demonstration only. Not redeemable at Burger King. No commercial partnership.',
    };
  }
}
