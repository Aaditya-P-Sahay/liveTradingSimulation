import React, { useState, useEffect } from 'react'
import { supabase, StockData } from './lib/supabase'
import { StockChart } from './components/StockChart'
import { StockSelector } from './components/StockSelector'
import { DataTable } from './components/DataTable'
import { Activity, RefreshCw } from 'lucide-react'

function App() {
  const [stockData, setStockData] = useState<StockData[]>([])
  const [symbols, setSymbols] = useState<string[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')

  // Fetch unique symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const { data, error } = await supabase
          .from('LALAJI')
          .select('symbol')
          .not('symbol', 'is', null)
        
        if (error) throw error
        
        const uniqueSymbols = [...new Set(data.map(item => item.symbol))].sort()
        setSymbols(uniqueSymbols)
        
        if (uniqueSymbols.length > 0 && !selectedSymbol) {
          setSelectedSymbol(uniqueSymbols[0])
        }
      } catch (err) {
        setError('Failed to fetch symbols: ' + (err as Error).message)
      }
    }

    fetchSymbols()
  }, [selectedSymbol])

  // Fetch stock data for selected symbol
  useEffect(() => {
    if (!selectedSymbol) return

    const fetchStockData = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('LALAJI')
          .select('*')
          .eq('symbol', selectedSymbol)
          .order('unique_id', { ascending: true })
          // Remove limit to show ALL data points for the selected symbol
        
        if (error) throw error
        
        setStockData(data || [])
        setError('')
      } catch (err) {
        setError('Failed to fetch stock data: ' + (err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    fetchStockData()
  }, [selectedSymbol])

  const refreshData = async () => {
    if (!selectedSymbol) return
    
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('LALAJI')
        .select('*')
        .eq('symbol', selectedSymbol)
        .order('unique_id', { ascending: true })
        // Remove limit to fetch ALL data points
      
      if (error) throw error
      
      setStockData(data || [])
      setError('')
    } catch (err) {
      setError('Failed to refresh data: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Activity className="w-8 h-8 text-blue-600 mr-3" />
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Stock Market Dashboard</h1>
              <p className="text-gray-600">Real-time stock data visualization</p>
            </div>
          </div>
          <button
            onClick={refreshData}
            disabled={loading}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {/* Stock Selector */}
        <StockSelector
          symbols={symbols}
          selectedSymbol={selectedSymbol}
          onSymbolChange={setSelectedSymbol}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mr-3" />
            <span className="text-gray-600">Loading stock data...</span>
          </div>
        )}

        {/* Stock Chart */}
        {!loading && stockData.length > 0 && (
          <div className="mb-6">
            <StockChart data={stockData} symbol={selectedSymbol} />
          </div>
        )}

        {/* Data Table */}
        {!loading && stockData.length > 0 && (
          <DataTable data={stockData} />
        )}

        {/* No Data Message */}
        {!loading && stockData.length === 0 && selectedSymbol && (
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No Data Available</h3>
            <p className="text-gray-500">No stock data found for {selectedSymbol}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App