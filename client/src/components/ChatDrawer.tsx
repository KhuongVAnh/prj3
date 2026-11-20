/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - IN-CALL CHAT DRAWER (NGĂN KÉO TIN NHẮN)
 * ============================================================================
 * Ngăn kéo chat trượt từ cạnh phải màn hình:
 *  - Trao đổi tin nhắn văn bản tức thời qua WebSocket trong lúc đang gọi video.
 *  - Phân biệt tin nhắn của bản thân (căn phải) và đối phương (căn trái).
 *  - Tự động cuộn xuống dòng tin nhắn mới nhất.
 */

import React, { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  currentUserId?: string;
  onSendMessage: (text: string) => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  currentUserId,
  onSendMessage
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <aside className="fixed sm:static inset-y-0 right-0 z-30 w-full sm:w-80 md:w-96 flex flex-col bg-surface border-l border-line-subtle animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-line-subtle bg-surface">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-ink-secondary" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold text-ink-primary">Tin nhắn trong phòng</h3>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-surface-subtle border border-line-subtle text-ink-secondary font-mono tabular-nums">
            {messages.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Đóng tin nhắn"
          className="p-1.5 rounded-xl text-ink-secondary hover:text-ink-primary hover:bg-surface-muted transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface-subtle">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ink-muted">
            <MessageSquare className="w-7 h-7 mb-2.5 text-ink-muted" strokeWidth={1.5} />
            <p className="text-xs text-ink-secondary">Chưa có tin nhắn nào. Hãy gửi lời chào để bắt đầu.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 text-[11px] text-ink-muted mb-1 px-0.5">
                  <span className="font-medium text-ink-secondary">{isMe ? 'Bạn' : msg.senderName}</span>
                  <span className="font-mono">{timeStr}</span>
                </div>
                <div
                  className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed break-words ${
                    isMe
                      ? 'bg-accent text-white rounded-tr-sm shadow-sm'
                      : 'bg-surface text-ink-primary border border-line-subtle rounded-tl-sm shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-line-subtle bg-surface flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Nhập tin nhắn..."
          className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-subtle border border-line-subtle text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:bg-surface focus:border-accent"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          title="Gửi tin nhắn"
          className="p-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Send className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </form>
    </aside>
  );
};
