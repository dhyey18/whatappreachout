'use client'
import { Toaster } from 'react-hot-toast'

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: '10px',
          background: '#1f2937',
          color: '#f9fafb',
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: '#f9fafb' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#f9fafb' },
        },
      }}
    />
  )
}
