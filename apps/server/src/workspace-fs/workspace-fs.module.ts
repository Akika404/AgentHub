import { Module } from '@nestjs/common'
import { UserModule } from '../user/user.module.js'
import { WorkspaceFsController } from './workspace-fs.controller.js'
import { WorkspaceFsService } from './workspace-fs.service.js'

@Module({
    imports: [UserModule],
    controllers: [WorkspaceFsController],
    providers: [WorkspaceFsService],
    exports: [WorkspaceFsService]
})
export class WorkspaceFsModule {}
