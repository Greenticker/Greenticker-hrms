import React, { useEffect, useState } from 'react';
import { request } from '../../services/api';
import { X, Bell, CheckCircle2, Clock, Calendar, AlertCircle } from 'lucide-react';

interface NotificationItem {
  _id: string;
  recipientUserId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({ isOpen, onClose }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await request<{ notifications: NotificationItem[] }>('/notifications');
      setNotifications(res.notifications);
    } catch (err) {
      console.error('Failed to load notifications', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await request(`/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error('Failed to mark read', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await request('/notifications/mark-all-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      console.error('Failed to mark all read', err);
    }
  };

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/30 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-8">Loading updates...</p>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700">All caught up!</p>
              <p className="text-[11px] text-slate-400 mt-1">No pending alerts</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n._id}
                onClick={() => markAsRead(n._id)}
                className={`p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                  n.isRead
                    ? 'bg-white border-slate-200 text-slate-600'
                    : 'bg-indigo-50/50 border-indigo-200 text-slate-900 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
                    {n.title}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">{n.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
