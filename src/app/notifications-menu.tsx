"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/timezone";

export type NotificationItem = {
  body: string;
  createdAt: string;
  id: string;
  status: string;
  target: string | null;
  title: string;
};

type NotificationsMenuProps = {
  initialNotifications: NotificationItem[];
};

export function NotificationsMenu({ initialNotifications }: NotificationsMenuProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isOpen, setIsOpen] = useState(false);
  const knownNotificationIds = useRef(new Set(initialNotifications.map((notification) => notification.id)));
  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.status === "UNREAD").length,
    [notifications]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        const data = await response.json();

        if (!cancelled && response.ok) {
          const hasNewNotification = data.notifications.some(
            (notification: NotificationItem) => !knownNotificationIds.current.has(notification.id)
          );

          data.notifications.forEach((notification: NotificationItem) => {
            knownNotificationIds.current.add(notification.id);
          });
          setNotifications(data.notifications);

          if (hasNewNotification) {
            router.refresh();
          }
        }
      } catch {
        // The UI keeps the last known notifications if polling fails.
      }
    }

    const interval = window.setInterval(loadNotifications, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function markAsRead() {
    if (unreadCount === 0) {
      return;
    }

    setNotifications((current) =>
      current.map((notification) => ({ ...notification, status: "READ" }))
    );

    try {
      await fetch("/api/notifications", { method: "POST" });
    } catch {
      // If the read marker fails, polling will restore the server state.
    }
  }

  async function openNotifications() {
    const nextOpen = !isOpen;

    setIsOpen(nextOpen);

    if (nextOpen) {
      document.getElementById("notificaciones")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    if (nextOpen && unreadCount > 0) {
      await markAsRead();
    }
  }

  return (
    <div className="relative scroll-mt-4" id="notificaciones">
      {unreadCount > 0 ? (
        <button
          className="notification-beacon"
          onClick={() => {
            setIsOpen(true);
            document.getElementById("notificaciones")?.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
            void markAsRead();
          }}
          type="button"
        >
          <Bell size={16} />
          {unreadCount} nueva{unreadCount === 1 ? "" : "s"}
        </button>
      ) : null}

      <button
        className={`secondary-button ${unreadCount > 0 ? "notification-pulse" : ""}`}
        onClick={openNotifications}
        type="button"
      >
        <Bell size={16} />
        Notificaciones
        {unreadCount > 0 ? (
          <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-md border border-black/10 bg-white shadow-soft">
          {notifications.map((notification) => (
            <Link
              className="block border-b border-black/10 px-4 py-3 text-left last:border-b-0 hover:bg-paper"
              href={notification.target || "/"}
              key={notification.id}
              onClick={() => setIsOpen(false)}
            >
              <p className="font-semibold text-ink">{notification.title}</p>
              <p className="mt-1 text-sm text-ink/60">{notification.body}</p>
              <p className="mt-1 text-xs text-ink/45">{formatDateTime(notification.createdAt)}</p>
            </Link>
          ))}
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">Sin notificaciones.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(value));
}
