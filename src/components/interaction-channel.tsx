import {
  Building2,
  GraduationCap,
  Hash,
  Landmark,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Send,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  type InteractionChannel,
  interactionChannelLabel,
} from "@/domain/interaction";

const channelIcons: Record<InteractionChannel, LucideIcon> = {
  email: Mail,
  linkedin_dm: MessageSquare,
  linkedin_connection_note: UserPlus,
  whatsapp: MessageCircle,
  phone: Phone,
  telegram: Send,
  slack_discord: Hash,
  company_referral_portal: Building2,
  alumni_network: GraduationCap,
  college_network: Landmark,
  in_person: Users,
  other: MoreHorizontal,
};

export function InteractionChannelMark({
  channel,
}: {
  channel: InteractionChannel;
}) {
  const Icon = channelIcons[channel];
  return (
    <span className="interaction-channel">
      <Icon aria-hidden="true" />
      {interactionChannelLabel(channel)}
    </span>
  );
}
