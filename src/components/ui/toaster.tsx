import { useToast } from "../../hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, open, hideClose, ...props }) {
        return (
          <Toast key={id} variant={variant} {...props} className="data-[state=open]:animate-slide-in data-[state=closed]:animate-slide-out">
            <div className="flex items-center gap-3 flex-1">
              {/* Icon with background */}
              {variant === 'success' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400 border border-green-500/30">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {variant === 'destructive' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400 border border-red-500/30">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              )}
              {variant === 'warning' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center text-yellow-400 border border-yellow-500/30">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 4v2" />
                  </svg>
                </div>
              )}
              
              {/* Text content */}
              <div className="flex-1 min-w-0">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
            </div>
            
            {/* Action button */}
            {action && <div className="flex-shrink-0">{action}</div>}
            
            {/* Close button */}
            {!hideClose && <ToastClose />}
            
            {/* Progress bar */}
            <div className="absolute bottom-0 left-0 h-0.5 w-full bg-white/5 rounded-b-xl overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r from-blue-500 to-blue-600 ${
                  (variant === 'success' || variant === 'destructive' || variant === 'warning') ? 'toast-progress' : ''
                }`}
              ></div>
            </div>
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
