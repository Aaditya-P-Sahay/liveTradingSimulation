import React from 'react'
import { Search } from 'lucide-react'

interface StockSelectorProps {
  symbols: string[]
  selectedSymbol: string
  onSymbolChange: (symbol: string) => void
  searchTerm: string
  onSearchChange: (term: string) => void
}

export const StockSelector: React.FC<StockSelectorProps> = ({
  symbols,
  selectedSymbol,
  onSymbolChange,
  searchTerm,
  onSearchChange
}) => {
  const filteredSymbols = symbols.filter(symbol =>
    symbol.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Select Stock</h2>
      
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Search stocks..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-40 overflow-y-auto">
        {filteredSymbols.map((symbol) => (
          <button
            key={symbol}
            onClick={() => onSymbolChange(symbol)}
            className={`px-3 py-2 text-sm rounded-lg transition-colors ${
              selectedSymbol === symbol
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {symbol}
          </button>
        ))}
      </div>
    </div>
  )
}