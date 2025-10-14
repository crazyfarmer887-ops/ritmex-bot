# GRVT Hedge Strategy

The GRVT Hedge strategy is designed to place simultaneous buy and sell orders with automatic stop-loss management on the GRVT exchange.

## Features

- **Simultaneous Buy/Sell Orders**: Places limit orders on both sides of the market spread
- **Automatic Stop-Loss**: When a position is opened, automatically creates a stop-loss order
- **Risk Management**: Configurable spread percentage and stop-loss percentage
- **Order Cooldown**: Prevents rapid order placement with a 5-second cooldown

## Configuration

Set the following environment variables in your `.env` file:

```bash
# Exchange selection (required)
EXCHANGE=grvt

# GRVT credentials
GRVT_API_KEY=your_api_key
GRVT_API_SECRET=your_api_secret
GRVT_SUB_ACCOUNT_ID=your_sub_account_id
GRVT_INSTRUMENT=BTC_USDT_PERP

# Strategy parameters
GRVT_SYMBOL=BTCUSDT
GRVT_TRADE_AMOUNT=0.001       # Trade size for each order
GRVT_SPREAD_PCT=0.5           # Spread percentage from mid price (0.5%)
GRVT_STOP_LOSS_PCT=2          # Stop loss percentage (2%)
GRVT_PRICE_TICK=0.1           # Minimum price increment
GRVT_QTY_STEP=0.0001          # Minimum quantity increment
```

## Running the Strategy

### Interactive Mode
```bash
bun run index.ts
# Select "GRVT 헤지 전략" from the menu
```

### CLI Mode
```bash
bun run index.ts --strategy grvt-hedge
```

### Silent Mode (for background/daemon operation)
```bash
bun run index.ts --strategy grvt-hedge --silent
```

## How It Works

1. **Initial Order Placement**:
   - Calculates the mid price from the order book
   - Places a buy order at `mid_price * (1 - spread_pct)`
   - Places a sell order at `mid_price * (1 + spread_pct)`
   - Both orders are placed simultaneously

2. **Position Management**:
   - When either order fills, a position is created
   - The opposite order is automatically cancelled by the exchange

3. **Stop-Loss Protection**:
   - Once a position is established, a stop-loss order is placed
   - For long positions: stop-loss at `entry_price * (1 - stop_loss_pct)`
   - For short positions: stop-loss at `entry_price * (1 + stop_loss_pct)`

4. **Order Renewal**:
   - After position is closed (either by stop-loss or manual), new hedge orders are placed
   - 5-second cooldown prevents excessive order placement

## Risk Considerations

- This strategy involves market making and can result in losses during trending markets
- Ensure you understand the risks before running with real funds
- Start with small trade amounts to test the strategy
- Monitor the strategy regularly, especially during volatile market conditions

## Monitoring

The UI displays:
- Current position and P&L
- Active buy/sell orders
- Stop-loss orders
- Order cooldown status
- Any errors encountered

Press `S` to start/stop the strategy and `Q` to quit.