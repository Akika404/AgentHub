import { Module } from '@nestjs/common'
import { UserWorkspaceService } from './user-workspace.service.js'

@Module({
    providers: [UserWorkspaceService],
    exports: [UserWorkspaceService]
})
export class UserWorkspaceModule {}
