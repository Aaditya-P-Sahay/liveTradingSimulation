import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { TrendingUp, TrendingDown, Shield, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

type OrderAction = 'BUY' | 'SELL' | 'SHORT' | 'COVER';

export const TradingPanel: React.FC = () => {
  const { user, chartState, marketData, portfolio, addTrade } = useStore();
  const [orderAction, setOrderAction] = useState<OrderAction>('BUY');
  const [quantity, setQuantity] = useState<number>(1);
  const [stopLoss, setStopLoss] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const currentPrice = marketData[chartState.symbol]?.last_traded_price || 0;
  const totalAmount = quantity * currentPrice;
  const availableCash = portfolio?.available_cash || 0;

  const validateOrder = (): string | null => {
    if (quantity < 1 || quantity > 10000) {
      return 'Quantity must be between 1 and 10,000 shares';
    }
    
    if (orderAction === 'BUY' && totalAmount > availableCash) {
      return 'Insufficient funds for this order';
    }
    
    if (stopLoss && orderAction === 'BUY' && stopLoss >= currentPrice) {
      return 'Stop loss must be below current price for buy orders';
    }
    
    if (stopLoss && orderAction === 'SELL' && stopLoss <= currentPrice) {
      return 'Stop loss must be above current price for sell orders';
    }
    
    return null;
  };

  const executeOrder = async () => {
    const validationError = validateOrder();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsLoading(true);
    
    try {
      // Create trade record
      const trade = {
        id: crypto.randomUUID(),
        user_id: user!.id,
        symbol: chartState.symbol,
        action: orderAction,
        quantity,
        price: currentPrice,
        total_amount: totalAmount,
        stop_loss: stopLoss,
        timestamp: new Date().toISOString(),
        status: 'executed' as const,
      };

      const { error: tradeError } = await supabase
        .from('trades')
        .insert([trade]);

      if (tradeError) throw tradeError;

      // Update portfolio
      const cashChange = orderAction === 'BUY' || orderAction === 'COVER' 
        ? -totalAmount 
        : totalAmount;

      const { error: portfolioError } = await supabase
        .from('portfolios')
        .update({
          available_cash: availableCash + cashChange,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user!.id);

      if (portfolioError) throw portfolioError;

      // Update or create position
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', user!.id)
        .eq('symbol', chartState.symbol)
        .single();

      if (existingPosition) {
        // Update existing position
        const newQuantity = orderAction === 'BUY' || orderAction === 'SHORT'
          ? existingPosition.quantity + quantity
          : existingPosition.quantity - quantity;

        if (newQuantity === 0) {
          // Close position
          await supabase
            .from('positions')
            .delete()
            .eq('id', existingPosition.id);
        } else {
          // Update position
          const newAveragePrice = orderAction === 'BUY' || orderAction === 'SHORT'
            ? ((existingPosition.average_price * existingPosition.quantity) + totalAmount) / newQuantity
            : existingPosition.average_price;

          await supabase
            .from('positions')
            .update({
              quantity: newQuantity,
              average_price: newAveragePrice,
              current_price: currentPrice,
              unrealized_pnl: (currentPrice - newAveragePrice) * newQuantity,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingPosition.id);
        }
      } else if (orderAction === 'BUY' || orderAction === 'SHORT') {
        // Create new position
        await supabase
          .from('positions')
          .insert([{
            id: crypto.randomUUID(),
            user_id: user!.id,
            symbol: chartState.symbol,
            quantity,
            average_price: currentPrice,
            current_price: currentPrice,
            position_type: orderAction === 'BUY' ? 'long' : 'short',
            unrealized_pnl: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }]);
      }

      addTrade(trade);
      toast.success(`${orderAction} order executed successfully!`);
      
      // Reset form
      setQuantity(1);
      setStopLoss(undefined);
      
    } catch (error: any) {
      toast.error('Order execution failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getActionColor = (action: OrderAction) => {
    switch (action) {
      case 'BUY': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'SELL': return 'text-red-400 bg-red-500/20 border-red-500/30';
      case 'SHORT': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'COVER': return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
    }
  };

  const getActionIcon = (action: OrderAction) => {
    switch (action) {
      case 'BUY': return <TrendingUp className="w-4 h-4" />;
      case 'SELL': return <TrendingDown className="w-4 h-4" />;
      case 'SHORT': return <TrendingDown className="w-4 h-4" />;
      case 'COVER': return <TrendingUp className="w-4 h-4" />;
    }
  };

  return (
    <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-white">Trading Panel</h3>
        <div className="text-sm text-gray-400">
          {chartState.symbol} @ ${currentPrice.toFixed(2)}
        </div>
      </div>

      {/* Order Type Selection */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {(['BUY', 'SELL', 'SHORT', 'COVER'] as OrderAction[]).map((action) => (
          <button
            key={action}
            onClick={() => setOrderAction(action)}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-lg border transition-all ${
              orderAction === action
                ? getActionColor(action)
                : 'text-gray-400 bg-gray-700/30 border-gray-600 hover:bg-gray-700/50'
            }`}
          >
            {getActionIcon(action)}
            <span className="font-medium">{action}</span>
          </button>
        ))}
      </div>

      {/* Order Details */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Quantity (1-10,000 shares)
          </label>
          <input
            type="number"
            min="1"
            max="10000"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Stop Loss (Optional)
          </label>
          <input
            type="number"
            step="0.01"
            value={stopLoss || ''}
            onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Enter stop loss price"
            className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Order Summary */}
        <div className="bg-gray-900/50 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Current Price:</span>
            <span className="text-white">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Quantity:</span>
            <span className="text-white">{quantity.toLocaleString()} shares</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total Amount:</span>
            <span className="text-white font-medium">${totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Available Cash:</span>
            <span className={`font-medium ${
              totalAmount > availableCash ? 'text-red-400' : 'text-green-400'
            }`}>
              ${availableCash.toFixed(2)}
            </span>
          </div>
          {stopLoss && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Stop Loss:</span>
              <span className="text-amber-400">${stopLoss.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Execute Button */}
        <button
          onClick={executeOrder}
          disabled={isLoading || !currentPrice}
          className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all flex items-center justify-center space-x-2 ${
            getActionColor(orderAction)
          } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              {getActionIcon(orderAction)}
              <span>
                {orderAction} {quantity} {chartState.symbol} @ Market
              </span>
            </>
          )}
        </button>
      </div>

      {/* Available Cash Display */}
      <div className="mt-6 p-4 bg-gray-900/30 rounded-lg border border-gray-700/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <DollarSign className="w-5 h-5 text-amber-400" />
            <span className="text-gray-300">Available Cash</span>
          </div>
          <span className="text-xl font-bold text-white">
            ${availableCash.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};