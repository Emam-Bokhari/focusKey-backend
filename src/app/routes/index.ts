import express from "express";
import { UserRoutes } from "../modules/user/user.routes";
import { AuthRoutes } from "../modules/auth/auth.routes";
import { RuleRoutes } from "../modules/rule/rule.route";
import { FaqRoutes } from "../modules/faq/faq.route";
import { ChatRoutes } from "../modules/chat/chat.routes";
import { MessageRoutes } from "../modules/message/message.routes";
import { NotificationRoutes } from "../modules/notification/notification.routes";
import { FcmTokenRoutes } from "../modules/fcmToken/fcmToken.route";
import { SupportRoutes } from "../modules/support/support.route";
import { BannerRoutes } from "../modules/banner/banner.route";
import { SettingsRoutes } from "../modules/settings/settings.route";
import { ModeRoutes } from "../modules/modes/modes.route";
import { BreakRoutes } from "../modules/breaks/breaks.route";
import { DashboardRoutes } from "../modules/dashboard/dashboard.route";
import { FocusSessionRoutes } from "../modules/focusSession/focusSession.route";

const router = express.Router();

const apiRoutes = [
  {
    path: "/users",
    route: UserRoutes,
  },
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/rules",
    route: RuleRoutes,
  },
  {
    path: "/faqs",
    route: FaqRoutes,
  },
  {
    path: "/chats",
    route: ChatRoutes,
  },
  {
    path: "/messages",
    route: MessageRoutes,
  },
  {
    path: "/supports",
    route: SupportRoutes,
  },
  {
    path: "/banners",
    route: BannerRoutes,
  },
  {
    path: "/notifications",
    route: NotificationRoutes,
  },
  {
    path: "/fcmTokens",
    route: FcmTokenRoutes,
  },
  {
    path: "/settings",
    route: SettingsRoutes,
  },
  {
    path: "/modes",
    route: ModeRoutes,
  },
  {
    path: "/breaks",
    route: BreakRoutes,
  },
  {
    path: "/dashboard",
    route: DashboardRoutes,
  },
  {
    path: "/focus-sessions",
    route: FocusSessionRoutes,
  },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));
export default router;
