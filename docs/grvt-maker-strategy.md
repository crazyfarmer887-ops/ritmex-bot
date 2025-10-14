# GRVT Maker Strategy - Synchronized Buy/Sell with Automatic Stop Loss

## Overview

The GRVT Maker Strategy is a specialized market-making strategy designed specifically for the GRVT exchange. It provides synchronized buy/sell trading with automatic stop loss protection using GRVT's native trigger order system.

## Key Features

### 1. Synchronized Buy/Sell Trading
Unlike traditional market-making strategies where buy and sell orders operate independently, this strategy ensures:
- **Both sides trade together**: Buy and sell orders are placed simultaneously for market-making
- **Automatic cancellation**: When one side fills (creating a position), the opposite side is immediately canceled
- **No independent trading**: Trades are coordinated to prevent unexpected exposure

### 2. Automatic Stop Loss Protection
- **Pre-placed stop orders**: Stop loss orders are added immediately when a position opens
- **Uses GRVT trigger system**: Leverages GRVT's native `trigger` metadata for reliable stop loss execution
- **Dynamic adjustment**: Stop loss orders are automatically adjusted as positions change
- **Risk management**: Configurable loss limits to protect against adverse moves

### 3. GRVT-Specific Implementation
- **Native trigger orders**: Uses GRVT's `STOP_MARKET` order type with trigger metadata
- **Proper trigger types**: Automatically sets `STOP_LOSS` for sell stops and `TAKE_PROFIT` for buy stops
- **Trigger price**: Configured via `trigger_by: "LAST"` to trigger based on last trade price
- **Full API compliance**: Follows GRVT API specifications for order creation

## Strategy Flow

### Initial State (No Position)
```
1. Calculate bid/ask prices based on market depth and configured offsets
2. Place synchronized orders:
   - BUY limit order at (topBid - bidOffset)
   - SELL limit order at (topAsk + askOffset)
3. Wait for one side to fill
```

### Position Opened (One Side Filled)
```
1. Detect position change via account snapshot
2. Cancel opposite side entry order immediately
3. Calculate stop loss price based on:
   - Entry price
   - Position direction (long/short)
   - Configured loss limit
4. Place stop loss order using GRVT trigger system
5. Place reduce-only close order at current market price
```

### Position Management
```
1. Monitor stop loss order status
2. Update stop loss if position or market conditions change
3. Maintain reduce-only close order
4. Exit when:
   - Close order fills (profit taking)
   - Stop loss triggers (loss protection)
   - Manual intervention
```

## Configuration

The strategy uses the standard `MakerConfig` from the main config:

```typescript
{
  symbol: string;              // Trading pair (e.g., "BTC_USDT_Perp")
  tradeAmount: number;         // Position size per trade
  bidOffset: number;           // Price offset below best bid
  askOffset: number;           // Price offset above best ask
  lossLimit: number;           // Maximum loss before stop triggers
  priceTick: number;           // Minimum price increment
  maxCloseSlippagePct: number; // Maximum allowed slippage for closes
  refreshIntervalMs: number;   // Strategy refresh interval
  maxLogEntries: number;       // Maximum log entries to keep
}
```

### Environment Variables

Required GRVT-specific environment variables:
```bash
GRVT_API_KEY=your_api_key
GRVT_API_SECRET=your_api_secret
GRVT_SUB_ACCOUNT_ID=your_sub_account_id
GRVT_INSTRUMENT=BTC_USDT_Perp
GRVT_SYMBOL=BTCUSDT
GRVT_ENV=testnet  # or prod
```

## Stop Loss Implementation

### GRVT Trigger Order Structure

The strategy uses GRVT's trigger order system:

```json
{
  "order": {
    "sub_account_id": "...",
    "is_market": true,
    "time_in_force": "GOOD_TILL_TIME",
    "post_only": false,
    "reduce_only": true,
    "legs": [{
      "instrument": "BTC_USDT_Perp",
      "size": "0.001",
      "is_buying_asset": false  // for SELL stop
    }],
    "metadata": {
      "client_order_id": "...",
      "trigger": {
        "trigger_type": "STOP_LOSS",  // or "TAKE_PROFIT" for BUY stops
        "tpsl": {
          "trigger_by": "LAST",
          "trigger_price": "65000.00",
          "close_position": true
        }
      }
    }
  }
}
```

### Stop Loss Price Calculation

For a long position:
```
stopPrice = entryPrice - (lossLimit / positionSize)
```

For a short position:
```
stopPrice = entryPrice + (lossLimit / positionSize)
```

The stop price is rounded to the nearest price tick for exchange compatibility.

## Usage

### Via CLI
```bash
# Start the GRVT Maker strategy
bun run index.ts --strategy grvt-maker --exchange grvt

# Silent mode (no UI)
bun run index.ts --strategy grvt-maker --exchange grvt --silent
```

### Via Interactive Menu
```bash
# Start the interactive menu
bun run index.ts

# Select "GRVT 同步做市策略" from the menu
```

### Programmatic Usage
```typescript
import { GrvtMakerEngine } from "./strategy/grvt-maker-engine";
import { buildAdapterFromEnv } from "./exchanges/resolve-from-env";
import { makerConfig } from "./config";

// Create adapter
const adapter = buildAdapterFromEnv({
  exchangeId: "grvt",
  symbol: makerConfig.symbol
});

// Create engine
const engine = new GrvtMakerEngine(makerConfig, adapter);

// Subscribe to updates
engine.on("update", (snapshot) => {
  console.log("Position:", snapshot.position.positionAmt);
  console.log("Open Orders:", snapshot.openOrders.length);
  console.log("Stop Orders:", snapshot.openOrders.filter(o => 
    o.type === "STOP_MARKET" || Number(o.stopPrice) > 0
  ).length);
});

// Start trading
engine.start();

// Stop trading
engine.stop();
```

## Order Types

The strategy uses three types of orders:

1. **Entry Orders** (`LIMIT`, `post_only: true`)
   - Synchronized buy and sell orders
   - Provide liquidity to the market
   - Automatically canceled when one side fills

2. **Stop Loss Orders** (`STOP_MARKET`, `reduce_only: true`)
   - Uses GRVT trigger system
   - Automatically placed when position opens
   - Protects against adverse price movements

3. **Close Orders** (`LIMIT`, `reduce_only: true`)
   - Placed at current market price
   - Allows profitable exit
   - Updated as market moves

## Risk Management

### Position Change Detection
- Monitors account snapshot for position changes
- Triggers immediate response when position opens/closes
- Ensures stop loss is always in place for open positions

### Stop Loss Maintenance
- Verifies stop loss exists for all positions
- Updates stop loss if calculation changes
- Prevents duplicate stop orders

### Rate Limiting
- Respects exchange rate limits
- Pauses entry orders during rate limit cooldown
- Maintains stop loss protection even during rate limiting

### Insufficient Balance Handling
- Detects insufficient balance errors
- Temporarily pauses new orders
- Logs cooldown period
- Automatically resumes when balance recovers

## Monitoring

### Dashboard Display
The UI shows:
- Current position (long/short/flat)
- Entry orders (buy/sell limits)
- Stop loss orders with trigger prices
- Close orders (reduce-only)
- Trade log with timestamps
- Feed status (account, orders, depth, ticker)

### Log Types
- `info`: General information
- `order`: Order placement/cancellation
- `stop`: Stop loss related actions
- `warn`: Warnings (rate limits, insufficient balance)
- `error`: Errors requiring attention

## Advantages Over Generic Maker Strategy

1. **GRVT-Specific Optimizations**
   - Uses native trigger orders (more reliable than polling)
   - Proper trigger type semantics (STOP_LOSS vs TAKE_PROFIT)
   - Optimized for GRVT API structure

2. **Synchronized Trading**
   - Prevents independent order execution
   - Reduces unexpected exposure
   - Better risk control

3. **Pre-placed Stop Loss**
   - Stop loss exists before position opens
   - No delay in protection
   - Uses exchange-native execution

4. **Position-Aware Logic**
   - Detects position changes immediately
   - Automatically adjusts order strategy
   - Maintains consistent risk management

## Limitations

1. **Exchange-Specific**: Only works with GRVT exchange
2. **Single Position**: Manages one position at a time
3. **No Hedging**: Does not support hedge mode
4. **Post-Only Entry**: May miss fills in fast markets

## Best Practices

1. **Configure Appropriate Loss Limits**: Set `lossLimit` based on your risk tolerance
2. **Monitor Feed Status**: Ensure all feeds are active before trading
3. **Test in Testnet**: Use `GRVT_ENV=testnet` for testing
4. **Check Position Size**: Ensure `tradeAmount` is within exchange limits
5. **Monitor Stop Loss**: Verify stop orders are properly placed
6. **Review Logs**: Check for errors or warnings regularly

## Troubleshooting

### Stop Loss Not Placing
- Check `GRVT_API_SECRET` is correctly set
- Verify position has valid entry price
- Ensure `lossLimit` is reasonable
- Check logs for specific error messages

### Orders Not Synchronizing
- Verify account snapshot is updating
- Check position detection logic
- Ensure order cancellation isn't failing
- Review feed status

### Rate Limiting
- Reduce `refreshIntervalMs` frequency
- Check exchange rate limit documentation
- Monitor rate limit cooldown logs

## See Also

- [GRVT Trading API Documentation](../docs/grvt/trading_api.md)
- [GRVT Market Data API](../docs/grvt/market_data_api.md)
- [Order Coordinator](../src/core/order-coordinator.ts)
- [Maker Engine](../src/strategy/maker-engine.ts)
