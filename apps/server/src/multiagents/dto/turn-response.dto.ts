import { ApiProperty } from '@nestjs/swagger'

/** POST converse 的返回：启动的 turn id。turn 在服务端游离运行，订阅其事件流以观看进度 */
export class StartTurnResultDto {
    @ApiProperty({ description: '新启动的 turn id；订阅其事件流观看进度' })
    turnId!: string
}

/** POST abort 的返回 */
export class AbortTurnResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已请求中止' })
    aborted!: true
}
