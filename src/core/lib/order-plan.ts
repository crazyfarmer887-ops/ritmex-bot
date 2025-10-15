import type { AsterOrder } from "../../exchanges/types";

export interface OrderTarget {
  side: "BUY" | "SELL";
  price: string; // 改为字符串避免精度问题
  amount: number;
  reduceOnly: boolean;
}

export function makeOrderPlan(
  openOrders: AsterOrder[],
  targets: OrderTarget[],
  opts?: { priceToleranceAbs?: number }
): { toCancel: AsterOrder[]; toPlace: OrderTarget[] } {
  const tolerance = typeof opts?.priceToleranceAbs === "number" && Number.isFinite(opts.priceToleranceAbs)
    ? Math.max(0, opts.priceToleranceAbs)
    : 0;
  const unmatched = new Set(targets.map((_, idx) => idx));
  const toCancel: AsterOrder[] = [];

  for (const order of openOrders) {
    const orderPriceStr = String(order.price);
    const orderPriceNum = Number(orderPriceStr);
    const reduceOnly = order.reduceOnly === true;
    const matchedIndex = targets.findIndex((target, index) => {
      const targetPriceNum = Number(target.price);
      const priceEqual =
        tolerance > 0 && Number.isFinite(orderPriceNum) && Number.isFinite(targetPriceNum)
          ? Math.abs(orderPriceNum - targetPriceNum) <= tolerance
          : orderPriceStr === target.price; // 直接使用字符串比较
      return (
        unmatched.has(index) &&
        target.side === order.side &&
        target.reduceOnly === reduceOnly &&
        priceEqual
      );
    });
    if (matchedIndex >= 0) {
      unmatched.delete(matchedIndex);
    } else {
      toCancel.push(order);
    }
  }

  const toPlace = [...unmatched]
    .map((idx) => targets[idx])
    .filter((t): t is OrderTarget => t !== undefined && t.amount > 1e-5);

  return { toCancel, toPlace };
}


