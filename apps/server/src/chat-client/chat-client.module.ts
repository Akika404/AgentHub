import { Module } from '@nestjs/common'
import { CHAT_CLIENT, DefaultChatClient } from './chat-client.js'

@Module({
    providers: [DefaultChatClient, { provide: CHAT_CLIENT, useExisting: DefaultChatClient }],
    exports: [DefaultChatClient, CHAT_CLIENT]
})
export class ChatClientModule {}
