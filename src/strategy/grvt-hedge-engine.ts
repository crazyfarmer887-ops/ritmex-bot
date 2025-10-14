import type { ExchangeAdapter } from "../exchanges/adapter";
import type { AsterAccountSnapshot, AsterDepth, AsterOrder, AsterTicker, CreateOrderParams } from "../exchanges/types";
import { EventEmitter } from "./common/event-emitter";
import { extractMessage } from "../utils/errors";
import { getPosition } from "../utils/strategy";
import { roundDownToTick, roundQtyDownToStep, formatPriceToString } from "../utils/math";
import { tradeLogWithContext } from "../logging/trade-log";
import type { LogFunction } from "../logging/logger";

const EPS = 1e-8;

export interface GrvtHedgeConfig {
  symbol: string;
  tradeAmount: number;
  spreadPct: number;
  stopLossPct: number;
  priceTick: number;
  qtyStep: number;
  logContext?: string;
}

export interface GrvtHedgeSnapshot {
  running: boolean;
  accountSnapshot: AsterAccountSnapshot | null;
  depthSnapshot: AsterDepth | null;
  tickerSnapshot: AsterTicker | null;
  openBuyOrders: AsterOrder[];
  openSellOrders: AsterOrder[];
  openStopOrders: AsterOrder[];
  lastError: string | null;
  lastOrderTime: number;
  ready: boolean;
  tradeLog: Array<{ time: string; type: string; detail: string }>;
}

export class GrvtHedgeEngine {
  readonly events = new EventEmitter();
  private running = false;
  private accountSnapshot: AsterAccountSnapshot | null = null;
  private depthSnapshot: AsterDepth | null = null;
  private tickerSnapshot: AsterTicker | null = null;
  private openOrders: AsterOrder[] = [];
  private lastError: string | null = null;
  private lastOrderTime = 0;
  private orderCooldownMs = 5000; // 5초 쿨다운
  private log: LogFunction;
  private tradeLogFn: LogFunction;
  private tradeLog: Array<{ time: string; type: string; detail: string }> = [];
  private ready = false;

  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly config: GrvtHedgeConfig
  ) {
    this.log = (type: string, message: string) => {
      console.log(`[GrvtHedge] [${type}] ${message}`);
    };
    this.tradeLogFn = tradeLogWithContext("GrvtHedge", config.logContext ?? config.symbol);
    this.addTradeLog("info", "GRVT 헤지 전략 초기화");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log("info", "GRVT 헤지 전략 시작");
    this.subscribeToEvents();
    this.emitUpdate();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.log("info", "GRVT 헤지 전략 중지");
    this.emitUpdate();
  }

  private subscribeToEvents(): void {
    this.exchange.watchAccount((snapshot) => {
      this.accountSnapshot = snapshot;
      if (!this.ready && this.depthSnapshot) {
        this.ready = true;
        this.addTradeLog("info", "시장 데이터 수신 시작");
      }
      void this.onAccountUpdate();
    });

    this.exchange.watchOrders((orders) => {
      this.openOrders = orders;
      void this.onOrderUpdate();
    });

    this.exchange.watchDepth(this.config.symbol, (depth) => {
      this.depthSnapshot = depth;
      if (!this.ready && this.accountSnapshot) {
        this.ready = true;
        this.addTradeLog("info", "시장 데이터 수신 시작");
      }
      void this.onDepthUpdate();
    });

    this.exchange.watchTicker(this.config.symbol, (ticker) => {
      this.tickerSnapshot = ticker;
      this.emitUpdate();
    });
  }

  private async onAccountUpdate(): Promise<void> {
    if (!this.running) return;
    await this.checkAndPlaceOrders();
    this.emitUpdate();
  }

  private async onOrderUpdate(): Promise<void> {
    if (!this.running) return;
    await this.checkAndPlaceOrders();
    this.emitUpdate();
  }

  private async onDepthUpdate(): Promise<void> {
    if (!this.running) return;
    await this.checkAndPlaceOrders();
    this.emitUpdate();
  }

  private async checkAndPlaceOrders(): Promise<void> {
    if (!this.depthSnapshot || !this.accountSnapshot) return;

    const now = Date.now();
    if (now - this.lastOrderTime < this.orderCooldownMs) return;

    const position = getPosition(this.accountSnapshot, this.config.symbol);
    const absPosition = Math.abs(position.positionAmt);

    // 활성 주문 확인
    const activeBuyOrders = this.openOrders.filter(o => 
      o.side === "BUY" && o.status === "NEW" && !o.stopPrice
    );
    const activeSellOrders = this.openOrders.filter(o => 
      o.side === "SELL" && o.status === "NEW" && !o.stopPrice
    );
    const activeStopOrders = this.openOrders.filter(o => 
      Number(o.stopPrice) > 0 && o.status === "NEW"
    );

    // 포지션이 없고 활성 주문도 없으면 새로운 헤지 주문 생성
    if (absPosition < EPS && activeBuyOrders.length === 0 && activeSellOrders.length === 0) {
      await this.placeHedgeOrders();
    }

    // 포지션이 있으면 스탑로스 확인
    if (absPosition > EPS && activeStopOrders.length === 0) {
      await this.placeStopLossOrder(position);
    }
  }

  private async placeHedgeOrders(): Promise<void> {
    const depth = this.depthSnapshot;
    if (!depth || !depth.bids.length || !depth.asks.length) return;

    const topBid = Number(depth.bids[0]?.[0]);
    const topAsk = Number(depth.asks[0]?.[0]);
    
    if (!Number.isFinite(topBid) || !Number.isFinite(topAsk)) return;

    const midPrice = (topBid + topAsk) / 2;
    const spread = this.config.spreadPct / 100;

    // 동시에 매수/매도 주문 생성
    const buyPrice = roundDownToTick(midPrice * (1 - spread), this.config.priceTick);
    const sellPrice = roundDownToTick(midPrice * (1 + spread), this.config.priceTick);
    const quantity = roundQtyDownToStep(this.config.tradeAmount, this.config.qtyStep);

    const priceDecimals = Math.max(0, Math.floor(Math.log10(1 / this.config.priceTick)));

    try {
      // 매수 주문
      const buyOrder: CreateOrderParams = {
        symbol: this.config.symbol,
        side: "BUY",
        type: "LIMIT",
        quantity,
        price: Number(formatPriceToString(buyPrice, priceDecimals)),
        timeInForce: "GTX"
      };

      // 매도 주문
      const sellOrder: CreateOrderParams = {
        symbol: this.config.symbol,
        side: "SELL",
        type: "LIMIT",
        quantity,
        price: Number(formatPriceToString(sellPrice, priceDecimals)),
        timeInForce: "GTX"
      };

      // 동시에 두 주문 실행
      const [buyResult, sellResult] = await Promise.allSettled([
        this.exchange.createOrder(buyOrder),
        this.exchange.createOrder(sellOrder)
      ]);

      if (buyResult.status === "fulfilled") {
        this.addTradeLog("order", `매수 주문 생성: ${buyPrice.toFixed(priceDecimals)} 수량: ${quantity}`);
      } else {
        this.addTradeLog("error", `매수 주문 실패: ${extractMessage(buyResult.reason)}`);
      }

      if (sellResult.status === "fulfilled") {
        this.addTradeLog("order", `매도 주문 생성: ${sellPrice.toFixed(priceDecimals)} 수량: ${quantity}`);
      } else {
        this.addTradeLog("error", `매도 주문 실패: ${extractMessage(sellResult.reason)}`);
      }

      this.lastOrderTime = Date.now();
    } catch (error) {
      this.lastError = extractMessage(error);
      this.log("error", `주문 생성 실패: ${this.lastError}`);
    }
  }

  private async placeStopLossOrder(position: { positionAmt: number; entryPrice: number }): Promise<void> {
    const absPosition = Math.abs(position.positionAmt);
    if (absPosition < EPS) return;

    const isLong = position.positionAmt > 0;
    const stopSide: "BUY" | "SELL" = isLong ? "SELL" : "BUY";
    const stopLossPct = this.config.stopLossPct / 100;

    // 스탑로스 가격 계산
    const stopPrice = isLong
      ? roundDownToTick(position.entryPrice * (1 - stopLossPct), this.config.priceTick)
      : roundDownToTick(position.entryPrice * (1 + stopLossPct), this.config.priceTick);

    const priceDecimals = Math.max(0, Math.floor(Math.log10(1 / this.config.priceTick)));
    const quantity = roundQtyDownToStep(absPosition, this.config.qtyStep);

    try {
      const stopOrder: CreateOrderParams = {
        symbol: this.config.symbol,
        side: stopSide,
        type: "STOP_MARKET",
        quantity,
        stopPrice: Number(formatPriceToString(stopPrice, priceDecimals)),
        reduceOnly: "true",
        closePosition: "true",
        timeInForce: "GTC",
        triggerType: stopSide === "SELL" ? "STOP_LOSS" : "TAKE_PROFIT"
      };

      const result = await this.exchange.createOrder(stopOrder);
      this.addTradeLog("stop", `스탑로스 주문 생성: ${stopSide} @ ${stopPrice.toFixed(priceDecimals)}`);
      this.lastOrderTime = Date.now();
    } catch (error) {
      this.lastError = extractMessage(error);
      this.log("error", `스탑로스 주문 실패: ${this.lastError}`);
    }
  }

  private buildSnapshot(): GrvtHedgeSnapshot {
    const openBuyOrders = this.openOrders.filter(o => o.side === "BUY" && !o.stopPrice);
    const openSellOrders = this.openOrders.filter(o => o.side === "SELL" && !o.stopPrice);
    const openStopOrders = this.openOrders.filter(o => Number(o.stopPrice) > 0);

    return {
      running: this.running,
      accountSnapshot: this.accountSnapshot,
      depthSnapshot: this.depthSnapshot,
      tickerSnapshot: this.tickerSnapshot,
      openBuyOrders,
      openSellOrders,
      openStopOrders,
      lastError: this.lastError,
      lastOrderTime: this.lastOrderTime,
      ready: this.ready,
      tradeLog: this.tradeLog
    };
  }

  private emitUpdate(): void {
    this.events.emit("update", this.buildSnapshot());
  }

  getSnapshot(): GrvtHedgeSnapshot {
    return this.buildSnapshot();
  }

  private addTradeLog(type: string, detail: string): void {
    const now = new Date();
    const time = now.toISOString().slice(11, 19);
    this.tradeLog.push({ time, type, detail });
    this.tradeLogFn(type, detail);
  }
}