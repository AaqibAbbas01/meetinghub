// Simple toast system using custom events
export function showToast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('meetflow-toast', {
    detail: { message, type, id: Date.now() + Math.random() }
  }))
}
