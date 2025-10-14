# GRVT Maker Strategy Implementation Summary

## Overview
Implemented a specialized market-making strategy for GRVT exchange that provides synchronized buy/sell trading with automatic stop loss protection.

## What Was Implemented

### 1. Core Strategy Engine
**File**: `src/strategy/grvt-maker-engine.ts`

Key features:
- Synchronized buy/sell order placement
- Automatic position change detection
- Pre-placed stop loss orders using GRVT trigger system
- Intelligent order cancellation when position opens
- Rate limiting and error handling
- Position-aware order management

Main differences from standard maker:
- Detects position changes and cancels opposite side immediately
- Uses GRVT's native trigger orders for stop loss
- Coordinates buy/sell orders to prevent independent trading
- Adds stop loss protection automatically when position opens

### 2. UI Component
**File**: `src/ui/GrvtMakerApp.tsx`

Features:
- Real-time position display
- Separate display for entry orders, stop orders, and close orders
- Trade log with colored status indicators
- Feed status monitoring
- PnL tracking

### 3. CLI Integration
**Files Updated**:
- `src/cli/args.ts` - Added `grvt-maker` strategy ID
- `src/cli/strategy-runner.ts` - Added GRVT Maker strategy factory
- `src/ui/App.tsx` - Added GRVT Maker to interactive menu

### 4. Tests
**File**: `tests/grvt-maker-engine.test.ts`

Tests:
- Engine instantiation
- Initial snapshot state
- Event emitter interface

### 5. Documentation
**File**: `docs/grvt-maker-strategy.md`

Comprehensive documentation covering:
- Strategy flow
- Configuration
- Stop loss implementation
- Usage examples
- Risk management
- Troubleshooting

## How It Works

### Buy/Sell Synchronization

1. **Initial State (No Position)**:
   - Places both BUY and SELL limit orders simultaneously
   - Orders are placed at configurable offsets from market price
   - Both orders rest in the book as post-only maker orders

2. **Position Opens (One Side Fills)**:
   - Position change is detected via account snapshot
   - Opposite side entry order is immediately canceled
   - Stop loss order is placed using GRVT trigger system
   - Reduce-only close order is placed at market price

3. **Position Management**:
   - Stop loss order continuously monitored
   - Close order updated as market moves
   - Exit occurs via close order fill or stop loss trigger

### Stop Loss Implementation

Uses GRVT's native trigger order system:

```typescript
// Order structure
{
  type: "STOP_MARKET",
  reduceOnly: true,
  stopPrice: calculatedStopPrice,
  triggerType: side === "BUY" ? "TAKE_PROFIT" : "STOP_LOSS",
  // GRVT API adds trigger metadata automatically
}
```

The gateway (`src/exchanges/grvt/gateway.ts`) transforms this into:

```json
{
  "metadata": {
    "trigger": {
      "trigger_type": "STOP_LOSS",
      "tpsl": {
        "trigger_by": "LAST",
        "trigger_price": "65000.00",
        "close_position": true
      }
    }
  }
}
```

## Key Components

### Position Change Detection
```typescript
private async handlePositionChange(position: PositionSnapshot): Promise<void> {
  const absPosition = Math.abs(position.positionAmt);
  
  if (absPosition > EPS) {
    // Position opened - cancel opposite side
    const oppositeSide: "BUY" | "SELL" = position.positionAmt > 0 ? "SELL" : "BUY";
    // Cancel opposite entry orders...
    
    // Ensure stop loss is in place
    await this.ensureStopLossOrder(position, lastPrice);
  }
}
```

### Order Synchronization
```typescript
private async syncOrders(targets: DesiredOrder[], position: PositionSnapshot): Promise<void> {
  // Separate stop orders from regular orders
  const stopOrders = openOrders.filter(o => isStopOrder(o));
  const regularOrders = openOrders.filter(o => !isStopOrder(o));
  
  // Match desired orders with existing orders
  // Cancel unmatched orders
  // Place missing orders
}
```

### Stop Loss Management
```typescript
private async ensureStopLossOrder(position: PositionSnapshot, lastPrice: number | null): Promise<void> {
  const stopSide = position.positionAmt > 0 ? "SELL" : "BUY";
  const targetStop = calcStopLossPrice(position.entryPrice, position.positionAmt, direction, lossLimit);
  
  // Find existing stop order
  const currentStop = this.openOrders.find(o => isStopOrder(o) && o.side === stopSide);
  
  if (!currentStop) {
    // Place new stop loss order
    await placeStopLossOrder(...);
  } else if (needsUpdate) {
    // Cancel and replace with updated stop price
    await this.exchange.cancelOrder({ orderId: currentStop.orderId });
    await placeStopLossOrder(...);
  }
}
```

## Usage

### Command Line
```bash
# Interactive mode
bun run index.ts

# Direct execution
bun run index.ts --strategy grvt-maker --exchange grvt

# Silent mode (no UI)
bun run index.ts --strategy grvt-maker --exchange grvt --silent
```

### Environment Setup
```bash
# Required GRVT credentials
export GRVT_API_KEY=your_api_key
export GRVT_API_SECRET=your_api_secret
export GRVT_SUB_ACCOUNT_ID=your_sub_account_id
export GRVT_INSTRUMENT=BTC_USDT_Perp
export GRVT_SYMBOL=BTCUSDT
export GRVT_ENV=testnet  # or prod

# Maker configuration
export MAKER_SYMBOL=BTC_USDT_Perp
export MAKER_TRADE_AMOUNT=0.001
export MAKER_BID_OFFSET=0.5
export MAKER_ASK_OFFSET=0.5
export MAKER_LOSS_LIMIT=10
export MAKER_PRICE_TICK=0.01
```

## Testing

Run the test suite:
```bash
bun x vitest run tests/grvt-maker-engine.test.ts
```

## Files Created/Modified

### New Files
- `src/strategy/grvt-maker-engine.ts` - Core strategy implementation
- `src/ui/GrvtMakerApp.tsx` - UI component
- `tests/grvt-maker-engine.test.ts` - Unit tests
- `docs/grvt-maker-strategy.md` - Strategy documentation
- `GRVT_MAKER_IMPLEMENTATION.md` - This file

### Modified Files
- `src/cli/args.ts` - Added strategy ID
- `src/cli/strategy-runner.ts` - Added strategy factory
- `src/ui/App.tsx` - Added menu option

## Benefits

1. **Synchronized Trading**: Buy and sell orders work together, not independently
2. **Automatic Protection**: Stop loss is placed immediately when position opens
3. **GRVT Native**: Uses GRVT's trigger order system for reliable execution
4. **Position-Aware**: Automatically adjusts orders based on position state
5. **Risk Management**: Pre-configured loss limits protect capital
6. **Exchange Optimized**: Designed specifically for GRVT's API and order types

## Differences from Standard Maker Strategy

| Feature | Standard Maker | GRVT Maker |
|---------|---------------|------------|
| Order Coordination | Independent | Synchronized |
| Stop Loss Timing | After position opens | Pre-placed trigger order |
| Stop Loss Type | Polling-based | Exchange-native trigger |
| Position Detection | Reactive | Proactive |
| Exchange Support | Generic | GRVT-specific |
| Trigger Orders | Not used | Native support |

## Future Enhancements

Possible improvements:
1. Support for multiple positions (hedging)
2. Dynamic offset adjustment based on volatility
3. Take profit orders in addition to stop loss
4. Partial position closing
5. Trailing stop loss using GRVT triggers
6. Support for other GRVT instruments (options, etc.)

## References

- GRVT Trading API: `docs/grvt/trading_api.md`
- GRVT Gateway Implementation: `src/exchanges/grvt/gateway.ts`
- Order Coordinator: `src/core/order-coordinator.ts`
- Standard Maker Engine: `src/strategy/maker-engine.ts`
