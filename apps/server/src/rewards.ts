export interface LunchRewardProvider {
  claim(passId: string): Promise<{ redeemable: boolean; offerUrl?: string; disclaimer: string }>;
}
export class PrototypeLunchProvider implements LunchRewardProvider {
  async claim() {
    return {
      redeemable: false,
      disclaimer:
        'Prototype Royal Lunch Perk: 40% of a squad lunch (Chanoly noodles for now). Prototype offer, terms apply.',
    };
  }
}
