/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - IN-CALL CHAT DRAWER (NGĂN KÉO TIN NHẮN)
 * ============================================================================
 * Ngăn kéo chat dạng trượt từ cạnh phải màn hình:
 *  - Trao đổi tin nhắn văn bản tức thời qua WebSocket trong lúc đang gọi video.
 *  - Phân biệt tin nhắn của bản thân (căn phải, màu xanh ngọc) và đối phương (căn trái).
 *  - Tự động cuộn xuống dòng tin nhắn mới nhất (Smooth Auto-scroll).
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
    <div className="fixed sm:static inset-y-0 right-0 z-30 w-full sm:w-84 md:w-96 flex flex-col bg-dark-900 border-l border-white/10 shadow-2xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-dark-850">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-bold text-slate-100">In-Call Messages</h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 font-mono">
            {messages.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <MessageSquare className="w-10 h-10 mb-2 opacity-40 text-brand-500" />
            <p className="text-xs">No messages yet. Send a message to your call partner.</p>
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
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1 px-1">
                  <span className="font-semibold text-slate-300">{isMe ? 'You' : msg.senderName}</span>
                  <span>•</span>
                  <span className="text-[10px] font-mono">{timeStr}</span>
                </div>
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs break-words ${
                    isMe
                      ? 'bg-brand-500 text-slate-950 font-medium rounded-tr-sm'
                      : 'bg-dark-800 text-slate-200 border border-white/10 rounded-tl-sm'
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
      <form onSubmit={handleSubmit} className="p-3 border-t border-white/10 bg-dark-850 flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send a message..."
          className="flex-1 px-3.5 py-2.5 rounded-xl bg-dark-900 border border-white/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500/50"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold transition-all shadow-md shadow-brand-500/20"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
