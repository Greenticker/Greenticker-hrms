import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';
import { Bot, X, Send, Sparkles, AlertCircle } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isBlocked?: boolean;
}

interface ChatbotDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export const ChatbotDrawer: React.FC<ChatbotDrawerProps> = ({ isOpen, onToggle, onClose }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `Hello ${user?.firstName || 'there'}! I am your Anusyuti HR Assistant. I can help answer questions regarding company policies, leave guidelines, working hours, benefits, and HR procedures. Note that all queries respect your ${user?.role || 'EMPLOYEE'} permissions.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isOpen]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: input.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await request<{ reply: string; blocked?: boolean; ticketCreated?: boolean; ticketNumber?: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt: userMsg.text }),
      });

      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        sender: 'assistant',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isBlocked: res.blocked,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: `Error connecting to HR assistant: ${err.message || 'Please check network or backend status.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isBlocked: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleQuestions = [
    'What is the company casual leave policy?',
    'How is overtime calculated?',
    'What are the standard working hours?',
    'Show me POSH compliance guidelines',
  ];

  return (
    <>
      {/* Floating Circular Button at Bottom Right */}
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-45 w-14 h-14 rounded-full bg-brand-gradient text-white flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer group"
        title="Open AI Policy & HR Assistant"
      >
        <Bot className="w-6 h-6 text-white group-hover:rotate-12 transition-transform" />
      </button>

      {/* Small Popup Window at Bottom Right */}
      {isOpen && (
        <div className="fixed bottom-22 right-6 z-50 w-80 sm:w-96 h-[460px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Anusyuti Assistant</span>
                  <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded font-mono font-semibold">
                    RBAC
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500">
                  Role: <strong className="font-semibold text-slate-700">{user?.role}</strong>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-slate-50/50">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-slate-900 text-white rounded-br-none'
                      : m.isBlocked
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-xs'
                  }`}
                >
                  {m.isBlocked && (
                    <div className="flex items-center gap-1 font-bold text-amber-800 mb-0.5 text-[11px]">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>RBAC Protection Policy</span>
                    </div>
                  )}
                  <p className="whitespace-pre-line">{m.text}</p>
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 px-1">{m.timestamp}</span>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2 w-fit shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions */}
          <div className="p-2.5 border-t border-slate-100 bg-white">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Suggested Queries
            </p>
            <div className="flex flex-wrap gap-1">
              {sampleQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-[10px] text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded transition-colors text-left cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Input Form */}
          <form onSubmit={handleSend} className="p-2.5 border-t border-slate-200 bg-white flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about policies, leave, overtime..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:bg-white"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};
