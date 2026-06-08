import { Module } from '@nestjs/common'
import { UserModule } from '../user/user.module.js'
import { UserWorkspaceModule } from '../user-workspace/user-workspace.module.js'
import { WorkspaceFsController } from './workspace-fs.controller.js'
import { WorkspaceFsService } from './workspace-fs.service.js'

@Module({
    imports: [UserModule, UserWorkspaceModule],
    controllers: [WorkspaceFsController],
    providers: [WorkspaceFsService],
    exports: [WorkspaceFsService]
})
export class WorkspaceFsModule {}
