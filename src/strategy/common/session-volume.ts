import type { PositionSnapshot } from "../../utils/strategy";

export class SessionVolumeTracker {
  private initialized = false;
  private previousPositionAmt = 0;
  private total = 0;
  private tradeCount = 0;
  private makerRebateRate: number;

  constructor(makerRebateRate: number = 0.00005) {
    this.makerRebateRate = makerRebateRate;
  }

  update(position: PositionSnapshot, referencePrice: number | null): void {
    if (!this.initialized) {
      this.previousPositionAmt = position.positionAmt;
      this.initialized = true;
      return;
    }
    if (referencePrice == null) {
      this.previousPositionAmt = position.positionAmt;
      return;
    }
    const delta = Math.abs(position.positionAmt - this.previousPositionAmt);
    if (delta > 0) {
      this.total += delta * referencePrice;
      this.tradeCount += 1;
    }
    this.previousPositionAmt = position.positionAmt;
  }

  get value(): number {
    return this.total;
  }

  get count(): number {
    return this.tradeCount;
  }

  get estimatedRebate(): number {
    return this.total * this.makerRebateRate;
  }
}
