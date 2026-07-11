import { VoiceState } from 'discord.js';
import { logVoiceJoin, logVoiceLeave, logVoiceMove } from '../modules/moderation/modLog';

export default {
  async execute(oldState: VoiceState, newState: VoiceState) {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const leftChannel   = oldState.channel;
    const joinedChannel = newState.channel;

    if (!leftChannel && joinedChannel) {
      await logVoiceJoin(member, joinedChannel).catch(() => {});
    } else if (leftChannel && !joinedChannel) {
      await logVoiceLeave(member, leftChannel).catch(() => {});
    } else if (leftChannel && joinedChannel && leftChannel.id !== joinedChannel.id) {
      await logVoiceMove(member, leftChannel, joinedChannel).catch(() => {});
    }
    // Same channel (mute/deafen/streaming toggle etc.) — not a join/leave/move, ignored.
  },
};
