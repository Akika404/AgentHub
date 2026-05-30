import type { User } from '../entities/user.entity.js'
import type { UserView } from '../dto/user-view.dto.js'

/**
 * User 实体 → 对外视图。
 *
 * 不暴露 passwordHash / updatedAt 等内部字段；Date 归一为 ISO 字符串。
 */
export function toUserView(user: User): UserView {
    return {
        id: user.id,
        account: user.account,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
        createdAt: user.createdAt.toISOString()
    }
}
