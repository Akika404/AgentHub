import { IsNotEmpty, IsString } from 'class-validator'

/** 与 agent 对话的入参（SSE 会话） */
export class ConverseDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string
}
