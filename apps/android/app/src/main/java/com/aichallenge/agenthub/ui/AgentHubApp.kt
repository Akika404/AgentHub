package com.aichallenge.agenthub.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aichallenge.agenthub.data.AgentQuestionDisplayMessage
import com.aichallenge.agenthub.data.AgentRunDisplayMessage
import com.aichallenge.agenthub.data.AgentView
import com.aichallenge.agenthub.data.ChatListItem
import com.aichallenge.agenthub.data.CreateAgentChatPayload
import com.aichallenge.agenthub.data.CreateAgentPayload
import com.aichallenge.agenthub.data.CreateGroupChatPayload
import com.aichallenge.agenthub.data.DEFAULT_API_BASE_URL
import com.aichallenge.agenthub.data.DisplayMessage
import com.aichallenge.agenthub.data.GroupChatView
import com.aichallenge.agenthub.data.OptionsDisplayMessage
import com.aichallenge.agenthub.data.OrchestratorConfig
import com.aichallenge.agenthub.data.ProjectMeta
import com.aichallenge.agenthub.data.ServerDirectoryEntry
import com.aichallenge.agenthub.data.SystemDisplayMessage
import com.aichallenge.agenthub.data.TaskListDisplayMessage
import com.aichallenge.agenthub.data.TextDisplayMessage
import com.aichallenge.agenthub.data.VENDOR_CAPABILITIES
import com.aichallenge.agenthub.data.agentInitials
import com.aichallenge.agenthub.data.isVendorProviderCompatible
import com.aichallenge.agenthub.data.sessionKind
import com.aichallenge.agenthub.data.sessionRawId
import com.aichallenge.agenthub.data.sessionKey
import com.aichallenge.agenthub.data.validateAgentForm
import com.aichallenge.agenthub.data.validateGroupForm
import com.aichallenge.agenthub.data.vendorLabel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray

@Composable
fun AgentHubApp(state: AppUiState, viewModel: AppViewModel) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message) {
        val message = state.message
        if (!message.isNullOrBlank()) {
            snackbar.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            !state.ready -> LoadingScreen()
            !state.session.authenticated -> AuthScreen(state, viewModel, snackbar)
            else -> MainShell(state, viewModel, snackbar)
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun AuthScreen(state: AppUiState, viewModel: AppViewModel, snackbar: SnackbarHostState) {
    var account by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var baseUrl by rememberSaveable(state.session.baseUrl) { mutableStateOf(state.session.baseUrl.ifBlank { DEFAULT_API_BASE_URL }) }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(WindowInsets.statusBars.asPaddingValues())
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Groups, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
            }
            Spacer(Modifier.height(16.dp))
            Text("AgentHub", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
            Text("移动端工作台", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))

            TabRow(selectedTabIndex = if (state.authMode == AuthMode.Login) 0 else 1) {
                Tab(selected = state.authMode == AuthMode.Login, onClick = { viewModel.setAuthMode(AuthMode.Login) }, text = { Text("登录") })
                Tab(selected = state.authMode == AuthMode.Register, onClick = { viewModel.setAuthMode(AuthMode.Register) }, text = { Text("注册") })
            }
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("API Base URL") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = account,
                onValueChange = { account = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("账号") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (state.authMode == AuthMode.Login) ImeAction.Done else ImeAction.Next),
                keyboardActions = KeyboardActions(onDone = {
                    if (state.authMode == AuthMode.Login) viewModel.login(account, password, baseUrl)
                })
            )
            AnimatedVisibility(state.authMode == AuthMode.Register) {
                Column {
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = confirm,
                        onValueChange = { confirm = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("确认密码") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done)
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = {
                    if (state.authMode == AuthMode.Register && password != confirm) {
                        viewModel.clearMessage()
                    } else if (state.authMode == AuthMode.Login) {
                        viewModel.login(account, password, baseUrl)
                    } else {
                        viewModel.register(account, password, baseUrl)
                    }
                },
                enabled = !state.loading,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text(if (state.authMode == AuthMode.Login) "登录" else "注册并登录")
            }
            if (state.authMode == AuthMode.Register && password != confirm && confirm.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text("两次输入的密码不一致", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun MainShell(state: AppUiState, viewModel: AppViewModel, snackbar: SnackbarHostState) {
    var showCreateAgent by rememberSaveable { mutableStateOf(false) }
    var showCreateChat by rememberSaveable { mutableStateOf(false) }
    var showCreateGroup by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    BottomItem(MainTab.Chats, state.mainTab, "聊天", Icons.Default.ChatBubble) { viewModel.setMainTab(MainTab.Chats) }
                    BottomItem(MainTab.Groups, state.mainTab, "群聊", Icons.Default.Groups) { viewModel.setMainTab(MainTab.Groups) }
                    BottomItem(MainTab.Agents, state.mainTab, "Agent", Icons.Default.Person) { viewModel.setMainTab(MainTab.Agents) }
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (state.mainTab) {
                MainTab.Chats -> ChatsScreen(state, viewModel, onCreateChat = { showCreateChat = true }, onCreateGroup = { showCreateGroup = true })
                MainTab.Groups -> GroupsScreen(state, viewModel, onCreateGroup = { showCreateGroup = true })
                MainTab.Agents -> AgentsScreen(state, viewModel, onCreateAgent = { showCreateAgent = true })
            }
            if (state.loading) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background.copy(alpha = 0.4f)),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }
            }
        }
    }

    if (showCreateAgent) CreateAgentSheet(state, viewModel) { showCreateAgent = false }
    if (showCreateChat) CreateChatSheet(state, viewModel) { showCreateChat = false }
    if (showCreateGroup) CreateGroupSheet(state, viewModel) { showCreateGroup = false }
    if (state.directoryPicker.open) DirectoryPickerSheet(state, viewModel)
}

@Composable
private fun RowScope.BottomItem(tab: MainTab, selected: MainTab, label: String, icon: ImageVector, onClick: () -> Unit) {
    val isSelected = selected == tab
    val tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Icon(icon, contentDescription = label, tint = tint)
        Text(label, color = tint, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatsScreen(
    state: AppUiState,
    viewModel: AppViewModel,
    onCreateChat: () -> Unit,
    onCreateGroup: () -> Unit
) {
    val active = state.activeKey
    if (active == null) {
        ChatListPane(state, viewModel, onCreateChat, onCreateGroup)
    } else {
        ChatDetailScreen(state, viewModel, active)
    }
}

@Composable
private fun ChatListPane(
    state: AppUiState,
    viewModel: AppViewModel,
    onCreateChat: () -> Unit,
    onCreateGroup: () -> Unit
) {
    var createMenu by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxSize()
            .padding(WindowInsets.statusBars.asPaddingValues())
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("聊天", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(state.session.user?.nickname ?: state.session.user?.account ?: "AgentHub", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = viewModel::refresh) { Icon(Icons.Default.Refresh, contentDescription = "刷新") }
            Box {
                IconButton(onClick = { createMenu = true }) { Icon(Icons.Default.Add, contentDescription = "新建") }
                DropdownMenu(expanded = createMenu, onDismissRequest = { createMenu = false }) {
                    DropdownMenuItem(text = { Text("创建和 Agent 单聊") }, leadingIcon = { Icon(Icons.Default.ChatBubble, null) }, onClick = { createMenu = false; onCreateChat() })
                    DropdownMenuItem(text = { Text("创建 Agent 群聊") }, leadingIcon = { Icon(Icons.Default.Groups, null) }, onClick = { createMenu = false; onCreateGroup() })
                    DropdownMenuItem(text = { Text("退出登录") }, leadingIcon = { Icon(Icons.Default.Close, null) }, onClick = { createMenu = false; viewModel.logout() })
                }
            }
        }
        OutlinedTextField(
            value = state.chatSearch,
            onValueChange = viewModel::setChatSearch,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            placeholder = { Text("搜索聊天、Agent、项目") },
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))
        val items = viewModel.chatItems()
        if (items.isEmpty()) {
            EmptyHint("还没有聊天，点击右上角 + 创建。")
        } else {
            LazyColumn(contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
                items(items, key = { it.key }) { item ->
                    ChatRow(item, viewModel)
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(item: ChatListItem, viewModel: AppViewModel) {
    var menu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .combinedClickable(
                onClick = { viewModel.selectChat(item.key) },
                onLongClick = { menu = true }
            )
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Avatar(text = item.avatarText, color = item.avatarColor, icon = if (item.kind == "group") Icons.Default.Groups else Icons.Default.Person)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(item.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                if (item.kind == "group") BadgeText("群聊")
                if (item.archived) BadgeText("已归档")
                if (item.pinned) Icon(Icons.Default.Check, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Text(item.preview, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
        }
        if (item.running) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(9.dp).clip(CircleShape).background(Color(0xFF10B981)))
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "更多") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(if (item.pinned) "取消置顶" else "置顶聊天") }, leadingIcon = { Icon(Icons.Default.Check, null) }, onClick = { menu = false; viewModel.togglePin(item) })
                DropdownMenuItem(text = { Text(if (item.archived) "取消归档" else "归档聊天") }, leadingIcon = { Icon(if (item.archived) Icons.Default.Unarchive else Icons.Default.Archive, null) }, onClick = { menu = false; viewModel.toggleArchive(item) })
                DropdownMenuItem(text = { Text("删除聊天") }, leadingIcon = { Icon(Icons.Default.Delete, null) }, onClick = { menu = false; viewModel.deleteChat(item) })
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ChatDetailScreen(state: AppUiState, viewModel: AppViewModel, activeKey: String) {
    val pagerState = rememberPagerState(pageCount = { 2 })
    val scope = rememberCoroutineScope()
    val activeAgentChat = state.agentChats.find { it.id == sessionRawId(activeKey) && sessionKind(activeKey) == "agent" }
    val activeGroup = state.groupChats.find { it.id == sessionRawId(activeKey) && sessionKind(activeKey) == "group" }
    val title = activeAgentChat?.let { com.aichallenge.agenthub.data.titleForChat(it) } ?: activeGroup?.title ?: "聊天"
    val archived = activeAgentChat?.archivedAt != null || activeGroup?.archivedAt != null || activeGroup?.status == "archived"
    val running = state.runningKeys.contains(activeKey)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (running) state.runtime.label else if (archived) "已归档" else "Active", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = { IconButton(onClick = { viewModel.showChatList() }) { Icon(Icons.Default.ArrowBack, contentDescription = "返回") } },
                actions = {
                    IconButton(onClick = { scope.launch { pagerState.animateScrollToPage(1) } }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        }
    ) { padding ->
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize().padding(padding)
        ) { page ->
            if (page == 0) {
                ConversationPage(state, viewModel, activeKey, archived, running)
            } else {
                SettingsPage(state, activeAgentChat, activeGroup)
            }
        }
    }
}

@Composable
private fun ConversationPage(state: AppUiState, viewModel: AppViewModel, activeKey: String, archived: Boolean, running: Boolean) {
    var input by rememberSaveable(activeKey) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().imePadding()) {
        if (state.messagesLoading) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(state.messages, key = { it.id }) { message -> MessageCard(message) }
            }
        }
        HorizontalDivider()
        Row(
            Modifier
                .fillMaxWidth()
                .padding(10.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                enabled = !archived && !running,
                minLines = 1,
                maxLines = 4,
                placeholder = { Text(if (archived) "已归档" else "输入消息") }
            )
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = {
                    if (running) viewModel.stopActiveRun()
                    else {
                        viewModel.sendMessage(input)
                        input = ""
                    }
                },
                enabled = running || (!archived && input.trim().isNotBlank())
            ) {
                Icon(if (running) Icons.Default.StopCircle else Icons.Default.Send, contentDescription = if (running) "停止" else "发送", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MessageCard(message: DisplayMessage) {
    when (message) {
        is SystemDisplayMessage -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text(message.text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        is TextDisplayMessage -> {
            val mine = message.sender.role == "user"
            Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, modifier = Modifier.fillMaxWidth(0.82f)) {
                    Text(message.sender.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Surface(
                        color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(message.text, modifier = Modifier.padding(10.dp), color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        is AgentRunDisplayMessage -> Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(message.sender.name.take(2), message.sender.color, Icons.Default.Person, size = 30.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("${message.sender.name} · ${message.status}", fontWeight = FontWeight.SemiBold)
                }
                message.steps.takeLast(6).forEach { step ->
                    Row(verticalAlignment = Alignment.Top) {
                        Box(Modifier.padding(top = 6.dp).size(7.dp).clip(CircleShape).background(if (step.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary))
                        Spacer(Modifier.width(8.dp))
                        Column {
                            Text(step.label, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                            if (!step.text.isNullOrBlank()) Text(step.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            if (step.todos.isNotEmpty()) {
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    step.todos.take(6).forEach { AssistChip(onClick = {}, label = { Text(it.text, maxLines = 1) }) }
                                }
                            }
                        }
                    }
                }
                if (message.text.isNotBlank()) Text(message.text)
            }
        }
        is TaskListDisplayMessage -> Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(message.heading, fontWeight = FontWeight.SemiBold)
                message.tasks.forEach { Text("• ${it.title} · ${it.status}", style = MaterialTheme.typography.bodySmall) }
            }
        }
        is OptionsDisplayMessage -> Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(message.text)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    message.options.forEach { AssistChip(onClick = {}, label = { Text(it.label) }) }
                }
            }
        }
        is AgentQuestionDisplayMessage -> Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(message.summary, fontWeight = FontWeight.SemiBold)
                message.questions.forEach { Text(it.question, style = MaterialTheme.typography.bodySmall) }
                message.answerText?.let { Text("已回复：$it", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsPage(state: AppUiState, agentChat: com.aichallenge.agenthub.data.AgentChatView?, group: GroupChatView?) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (agentChat != null) {
            item {
                DetailCard("Agent") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(agentInitials(agentChat.agent.name), agentChat.agent.color, Icons.Default.Person)
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(agentChat.agent.name, fontWeight = FontWeight.SemiBold)
                            Text("${vendorLabel(agentChat.agent.vendor)} / ${agentChat.agent.model}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            item {
                DetailCard("运行状态") {
                    Text(state.runtime.label, fontWeight = FontWeight.Medium)
                    state.runtime.detail?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    state.runtime.todos.forEach { Text("• ${it.text} · ${it.status}", style = MaterialTheme.typography.bodySmall) }
                }
            }
            item {
                DetailCard("工作区") {
                    KeyValue("Working Directory", agentChat.workingDirectory)
                    KeyValue("Chat Home", agentChat.sessionHomeDirectory)
                }
            }
        } else if (group != null) {
            item {
                DetailCard("群聊目标") {
                    Text(group.projectMeta.name, fontWeight = FontWeight.SemiBold)
                    Text(group.projectMeta.goal ?: "暂未设置目标", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(group.projectMeta.techStack.joinToString(", ").ifBlank { group.projectMeta.status }, style = MaterialTheme.typography.bodySmall)
                }
            }
            item {
                DetailCard("成员") {
                    group.members.forEach { member ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(agentInitials(member.name), member.color, Icons.Default.Person, size = 32.dp)
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text(member.name, fontWeight = FontWeight.Medium)
                                Text(member.roleInGroup ?: vendorLabel(member.vendor), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
            item {
                DetailCard("群设置") {
                    KeyValue("Orchestrator", "${vendorLabel(group.orchestrator.vendor)} / ${group.orchestrator.model}")
                    KeyValue("Workspace", group.workspaceDir)
                }
            }
            item {
                DetailCard("黑板任务") {
                    val board = state.blackboard
                    if (board == null || board.taskGraph.isEmpty()) Text("暂无任务", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    board?.taskGraph?.forEach { Text("• ${it.name} · ${it.status}", style = MaterialTheme.typography.bodySmall) }
                }
            }
            item {
                DetailCard("产出 / 决策 / 契约") {
                    val board = state.blackboard
                    Text("产出物 ${board?.artifacts?.size ?: 0}")
                    Text("决策 ${board?.decisions?.size ?: 0}")
                    Text("契约 ${board?.contracts?.size ?: 0}")
                }
            }
        }
    }
}

@Composable
private fun GroupsScreen(state: AppUiState, viewModel: AppViewModel, onCreateGroup: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(WindowInsets.statusBars.asPaddingValues())) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("群聊", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("成员、目标、黑板", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onCreateGroup) { Icon(Icons.Default.Add, contentDescription = "创建群聊") }
        }
        if (state.groupChats.isEmpty()) EmptyHint("还没有群聊。")
        else LazyColumn(contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(state.groupChats, key = { it.id }) { group ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            viewModel.selectChat(sessionKey("group", group.id))
                            viewModel.setMainTab(MainTab.Chats)
                        }
                ) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar("群", "#3370ff", Icons.Default.Groups)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(group.title, fontWeight = FontWeight.SemiBold)
                            Text("${group.members.size} 成员 · ${group.projectMeta.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (group.activeRunId != null) BadgeText("运行中")
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentsScreen(state: AppUiState, viewModel: AppViewModel, onCreateAgent: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(WindowInsets.statusBars.asPaddingValues())) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Agent", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("模型与能力配置", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onCreateAgent) { Icon(Icons.Default.Add, contentDescription = "创建 Agent") }
        }
        if (state.agents.isEmpty()) EmptyHint("还没有 Agent，请先创建。")
        else LazyColumn(contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.agents, key = { it.id }) { agent ->
                AgentCard(agent, viewModel)
            }
        }
    }
}

@Composable
private fun AgentCard(agent: AgentView, viewModel: AppViewModel) {
    var menu by remember { mutableStateOf(false) }
    Card {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(agentInitials(agent.name), agent.color, Icons.Default.Person)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(agent.name, fontWeight = FontWeight.SemiBold)
                Text("${vendorLabel(agent.vendor)} / ${agent.model}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                agent.capabilitySummary?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "更多") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("删除") }, leadingIcon = { Icon(Icons.Default.Delete, null) }, onClick = { menu = false; viewModel.deleteAgent(agent.id) })
                }
            }
        }
    }
}

@Composable
private fun Avatar(text: String, color: String?, icon: ImageVector, size: androidx.compose.ui.unit.Dp = 42.dp) {
    val parsed = remember(color) { runCatching { Color(android.graphics.Color.parseColor(color ?: "#3370ff")) }.getOrDefault(Color(0xFF3370FF)) }
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(8.dp))
            .background(parsed.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center
    ) {
        if (text.isBlank()) Icon(icon, contentDescription = null, tint = parsed)
        else Text(text.take(2), color = parsed, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun BadgeText(text: String) {
    Text(
        text,
        modifier = Modifier
            .padding(start = 4.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .padding(horizontal = 5.dp, vertical = 2.dp),
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        style = MaterialTheme.typography.labelSmall
    )
}

@Composable
private fun EmptyHint(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DetailCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
private fun KeyValue(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun CreateAgentSheet(state: AppUiState, viewModel: AppViewModel, onClose: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var avatar by rememberSaveable { mutableStateOf("") }
    var color by rememberSaveable { mutableStateOf("#3370ff") }
    var capability by rememberSaveable { mutableStateOf("") }
    var vendor by rememberSaveable { mutableStateOf("claude") }
    var providerId by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var workingDirectory by rememberSaveable { mutableStateOf("") }
    var skillDirs by rememberSaveable { mutableStateOf("") }
    var systemPrompt by rememberSaveable { mutableStateOf("") }
    var skills by rememberSaveable { mutableStateOf("") }
    var mcpServers by rememberSaveable { mutableStateOf("") }
    var allowedTools by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val pickedWorking = state.pickedPaths[DirectoryTarget.AgentWorking]
    val pickedSkills = state.pickedPaths[DirectoryTarget.AgentSkills]
    LaunchedEffect(pickedWorking) {
        val path = viewModel.consumePickedPaths(DirectoryTarget.AgentWorking).firstOrNull()
        if (path != null) workingDirectory = path
    }
    LaunchedEffect(pickedSkills) {
        val paths = viewModel.consumePickedPaths(DirectoryTarget.AgentSkills)
        if (paths.isNotEmpty()) skillDirs = mergeCsv(skillDirs, paths)
    }

    val caps = VENDOR_CAPABILITIES[vendor] ?: VENDOR_CAPABILITIES["codex"]!!
    val compatibleProviders = state.providers.filter { isVendorProviderCompatible(vendor, it.type) }
    val provider = state.providers.find { it.id == providerId }
    LaunchedEffect(vendor, state.providers) {
        if (compatibleProviders.none { it.id == providerId }) {
            providerId = compatibleProviders.firstOrNull()?.id.orEmpty()
            model = compatibleProviders.firstOrNull()?.modelList?.firstOrNull().orEmpty()
        }
    }
    LaunchedEffect(providerId) {
        val options = state.providers.find { it.id == providerId }?.modelList.orEmpty()
        if (options.isNotEmpty() && model !in options) model = options.first()
    }

    ModalBottomSheet(onDismissRequest = onClose) {
        SheetContent(title = "新建 Agent") {
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("名称") }, singleLine = true)
            OutlinedTextField(capability, { capability = it }, Modifier.fillMaxWidth(), label = { Text("能力摘要（可选）") }, minLines = 2, maxLines = 4)
            OutlinedTextField(avatar, { avatar = it }, Modifier.fillMaxWidth(), label = { Text("头像 data URL（可选）") }, singleLine = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(color, { color = it }, Modifier.weight(1f), label = { Text("颜色") }, singleLine = true)
                SelectField("Vendor", vendor, listOf("claude" to "Claude", "codex" to "Codex"), Modifier.weight(1f)) {
                    vendor = it
                    providerId = ""
                    model = ""
                }
            }
            SelectField(
                label = "PlatformProvider",
                value = providerId,
                options = compatibleProviders.map { it.id to it.platformName },
                modifier = Modifier.fillMaxWidth(),
                emptyLabel = if (compatibleProviders.isEmpty()) "没有兼容 Provider" else "请选择"
            ) {
                providerId = it
                model = state.providers.find { p -> p.id == it }?.modelList?.firstOrNull().orEmpty()
            }
            SelectField(
                label = "模型",
                value = model,
                options = provider?.modelList.orEmpty().map { it to it },
                modifier = Modifier.fillMaxWidth(),
                emptyLabel = "请选择模型"
            ) { model = it }
            DirectoryValueField("工作目录", workingDirectory, "点击选择服务端文件夹", required = true) {
                viewModel.openDirectoryPicker(DirectoryTarget.AgentWorking, "选择 Agent 工作目录", preferredKind = "agent_workspace", initialPaths = listOfNotNull(workingDirectory.takeIf { it.isNotBlank() }))
            }
            if (caps.supportsSystemPrompt) {
                OutlinedTextField(systemPrompt, { systemPrompt = it }, Modifier.fillMaxWidth(), label = { Text("System Prompt（可选）") }, minLines = 2, maxLines = 5)
            }
            if (caps.supportsSkills) {
                DirectoryValueField("Skill Folders", skillDirs, "点击选择服务端文件夹", multiple = true) {
                    viewModel.openDirectoryPicker(
                        DirectoryTarget.AgentSkills,
                        "选择 Skill 目录",
                        DirectoryMode.Multiple,
                        preferredKind = "skills",
                        initialPaths = csv(skillDirs)
                    )
                }
                OutlinedTextField(skills, { skills = it }, Modifier.fillMaxWidth(), label = { Text("Skills（all 或逗号分隔，可选）") }, singleLine = true)
            }
            if (caps.supportsMcp) {
                OutlinedTextField(mcpServers, { mcpServers = it }, Modifier.fillMaxWidth(), label = { Text("MCP Servers JSON（可选）") }, minLines = 2, maxLines = 5)
            }
            OutlinedTextField(allowedTools, { allowedTools = it }, Modifier.fillMaxWidth(), label = { Text("Allowed Tools（逗号分隔，可选）") }, singleLine = true)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    val invalid = validateAgentForm(name, color, providerId, model, workingDirectory)
                    if (invalid != null) {
                        error = invalid
                        return@Button
                    }
                    val mcp = parseJsonObject(mcpServers)
                    if (mcpServers.isNotBlank() && mcp == null) {
                        error = "MCP 配置不是合法 JSON Object"
                        return@Button
                    }
                    viewModel.createAgent(
                        CreateAgentPayload(
                            name = name.trim(),
                            avatar = avatar.trim().ifBlank { null },
                            color = color.trim().lowercase(),
                            capabilitySummary = capability.trim().ifBlank { null },
                            vendor = vendor,
                            platformProviderId = providerId,
                            model = model,
                            workingDirectory = workingDirectory,
                            systemPrompt = systemPrompt.takeIf { caps.supportsSystemPrompt }?.trim()?.ifBlank { null },
                            skillSourceDirectories = csv(skillDirs).takeIf { caps.supportsSkills && it.isNotEmpty() },
                            skills = parseSkills(skills).takeIf { caps.supportsSkills },
                            mcpServers = mcp.takeIf { caps.supportsMcp },
                            allowedTools = csv(allowedTools).takeIf { it.isNotEmpty() }
                        ),
                        onDone = onClose
                    )
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("创建 Agent") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateChatSheet(state: AppUiState, viewModel: AppViewModel, onClose: () -> Unit) {
    var agentId by rememberSaveable(state.agents.size) { mutableStateOf(state.agents.firstOrNull()?.id.orEmpty()) }
    var title by rememberSaveable { mutableStateOf("") }
    var workingDirectory by rememberSaveable { mutableStateOf("") }
    var skillDirs by rememberSaveable { mutableStateOf("") }
    var mcpServers by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val pickedWorking = state.pickedPaths[DirectoryTarget.ChatWorking]
    val pickedSkills = state.pickedPaths[DirectoryTarget.ChatSkills]
    LaunchedEffect(pickedWorking) {
        val path = viewModel.consumePickedPaths(DirectoryTarget.ChatWorking).firstOrNull()
        if (path != null) workingDirectory = path
    }
    LaunchedEffect(pickedSkills) {
        val paths = viewModel.consumePickedPaths(DirectoryTarget.ChatSkills)
        if (paths.isNotEmpty()) skillDirs = mergeCsv(skillDirs, paths)
    }

    val selected = state.agents.find { it.id == agentId }
    ModalBottomSheet(onDismissRequest = onClose) {
        SheetContent(title = "创建和 Agent 单聊") {
            if (state.agents.isEmpty()) {
                Text("还没有可用 Agent。请先在 Agent 页创建。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                SelectField("Agent", agentId, state.agents.map { it.id to "${it.name} · ${vendorLabel(it.vendor)} / ${it.model}" }, Modifier.fillMaxWidth()) { agentId = it }
                OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("标题（可选）") }, singleLine = true)
                DirectoryValueField("工作目录（可选）", workingDirectory, "点击选择服务端文件夹") {
                    viewModel.openDirectoryPicker(DirectoryTarget.ChatWorking, "选择聊天工作目录", preferredKind = "agent_workspace", initialPaths = listOfNotNull(workingDirectory.takeIf { it.isNotBlank() }))
                }
                if (selected?.capabilities?.supportsSkills == true) {
                    DirectoryValueField("Skill Folders（可选）", skillDirs, "点击选择服务端文件夹", multiple = true) {
                        viewModel.openDirectoryPicker(DirectoryTarget.ChatSkills, "选择 Skill 目录", DirectoryMode.Multiple, preferredKind = "skills", initialPaths = csv(skillDirs))
                    }
                }
                if (selected?.capabilities?.supportsMcp == true) {
                    OutlinedTextField(mcpServers, { mcpServers = it }, Modifier.fillMaxWidth(), label = { Text("MCP Servers JSON（可选）") }, minLines = 2, maxLines = 5)
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(
                    onClick = {
                        if (agentId.isBlank()) {
                            error = "请选择 Agent"
                            return@Button
                        }
                        val mcp = parseJsonObject(mcpServers)
                        if (mcpServers.isNotBlank() && mcp == null) {
                            error = "MCP 配置不是合法 JSON Object"
                            return@Button
                        }
                        viewModel.createAgentChat(
                            CreateAgentChatPayload(
                                agentId = agentId,
                                title = title.trim().ifBlank { null },
                                workingDirectory = workingDirectory.trim().ifBlank { null },
                                skillSourceDirectories = csv(skillDirs).takeIf { it.isNotEmpty() },
                                mcpServers = mcp
                            ),
                            onDone = onClose
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = state.agents.isNotEmpty()
                ) { Text("创建聊天") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun CreateGroupSheet(state: AppUiState, viewModel: AppViewModel, onClose: () -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var memberIds by remember { mutableStateOf(setOf<String>()) }
    var orchestratorVendor by rememberSaveable { mutableStateOf("claude") }
    var providerId by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var projectName by rememberSaveable { mutableStateOf("") }
    var projectGoal by rememberSaveable { mutableStateOf("") }
    var techStack by rememberSaveable { mutableStateOf("") }
    var projectStatus by rememberSaveable { mutableStateOf("planning") }
    var workspace by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val pickedWorkspace = state.pickedPaths[DirectoryTarget.GroupWorkspace]
    LaunchedEffect(pickedWorkspace) {
        val path = viewModel.consumePickedPaths(DirectoryTarget.GroupWorkspace).firstOrNull()
        if (path != null) workspace = path
    }

    val compatibleProviders = state.providers.filter { isVendorProviderCompatible(orchestratorVendor, it.type) }
    val provider = state.providers.find { it.id == providerId }
    LaunchedEffect(orchestratorVendor, state.providers) {
        if (compatibleProviders.none { it.id == providerId }) {
            providerId = compatibleProviders.firstOrNull()?.id.orEmpty()
            model = compatibleProviders.firstOrNull()?.modelList?.firstOrNull().orEmpty()
        }
    }
    LaunchedEffect(providerId) {
        val options = state.providers.find { it.id == providerId }?.modelList.orEmpty()
        if (options.isNotEmpty() && model !in options) model = options.first()
    }

    ModalBottomSheet(onDismissRequest = onClose) {
        SheetContent(title = "创建 Agent 群聊") {
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("群标题") }, singleLine = true)
            Text("成员 Agent", fontWeight = FontWeight.Medium)
            if (state.agents.isEmpty()) {
                Text("还没有可用 Agent。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.agents.forEach { agent ->
                        FilterChip(
                            selected = memberIds.contains(agent.id),
                            onClick = {
                                memberIds = if (memberIds.contains(agent.id)) memberIds - agent.id else memberIds + agent.id
                            },
                            label = { Text(agent.name) },
                            leadingIcon = if (memberIds.contains(agent.id)) ({ Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }) else null
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectField("Orchestrator", orchestratorVendor, listOf("claude" to "Claude", "codex" to "Codex"), Modifier.weight(1f)) {
                    orchestratorVendor = it
                    providerId = ""
                    model = ""
                }
                SelectField("阶段", projectStatus, listOf("planning", "designing", "development", "done").map { it to it }, Modifier.weight(1f)) { projectStatus = it }
            }
            SelectField("Provider", providerId, compatibleProviders.map { it.id to it.platformName }, Modifier.fillMaxWidth(), emptyLabel = if (compatibleProviders.isEmpty()) "没有兼容 Provider" else "请选择") {
                providerId = it
                model = state.providers.find { p -> p.id == it }?.modelList?.firstOrNull().orEmpty()
            }
            SelectField("Model", model, provider?.modelList.orEmpty().map { it to it }, Modifier.fillMaxWidth(), emptyLabel = "请选择模型") { model = it }
            OutlinedTextField(projectName, { projectName = it }, Modifier.fillMaxWidth(), label = { Text("项目名") }, singleLine = true)
            OutlinedTextField(projectGoal, { projectGoal = it }, Modifier.fillMaxWidth(), label = { Text("项目目标（可选）") }, minLines = 2, maxLines = 4)
            OutlinedTextField(techStack, { techStack = it }, Modifier.fillMaxWidth(), label = { Text("技术栈（逗号分隔，可选）") }, singleLine = true)
            DirectoryValueField("共享工作区目录（可选）", workspace, "点击选择服务端文件夹") {
                viewModel.openDirectoryPicker(DirectoryTarget.GroupWorkspace, "选择共享工作区", preferredKind = "agent_workspace", initialPaths = listOfNotNull(workspace.takeIf { it.isNotBlank() }))
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    val invalid = validateGroupForm(title, memberIds, providerId, model, projectName)
                    if (invalid != null) {
                        error = invalid
                        return@Button
                    }
                    viewModel.createGroupChat(
                        CreateGroupChatPayload(
                            title = title.trim(),
                            memberAgentIds = memberIds.toList(),
                            orchestrator = OrchestratorConfig(orchestratorVendor, model, providerId),
                            projectMeta = ProjectMeta(
                                name = projectName.trim(),
                                goal = projectGoal.trim().ifBlank { null },
                                techStack = csv(techStack),
                                status = projectStatus
                            ),
                            workspaceDir = workspace.trim().ifBlank { null }
                        ),
                        onDone = onClose
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = state.agents.isNotEmpty()
            ) { Text("创建群聊") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun DirectoryPickerSheet(state: AppUiState, viewModel: AppViewModel) {
    val picker = state.directoryPicker
    ModalBottomSheet(onDismissRequest = viewModel::closeDirectoryPicker) {
        SheetContent(title = picker.title) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(picker.listing?.root?.label ?: "服务器目录", fontWeight = FontWeight.Medium)
                    Text(picker.listing?.path ?: "正在加载", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { viewModel.openDirectory(picker.listing?.path) }, enabled = !picker.loading) {
                    Icon(Icons.Default.Refresh, contentDescription = "刷新")
                }
            }
            if (picker.roots.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    picker.roots.forEach { root ->
                        FilterChip(
                            selected = picker.listing?.root?.path == root.path,
                            onClick = { viewModel.openDirectory(root.path) },
                            label = { Text(root.label) }
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { viewModel.openDirectory(picker.listing?.parentPath) }, enabled = picker.listing?.parentPath != null && !picker.loading) {
                    Text("上一级")
                }
                TextButton(onClick = { picker.listing?.path?.let(viewModel::toggleDirectorySelection) }, enabled = picker.mode == DirectoryMode.Multiple && picker.listing != null) {
                    Text("加入当前")
                }
            }
            if (picker.loading) {
                Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else if (picker.error != null) {
                Text(picker.error, color = MaterialTheme.colorScheme.error)
            } else {
                LazyColumn(Modifier.height(320.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(picker.listing?.entries.orEmpty(), key = { it.path }) { entry ->
                        DirectoryEntryRow(entry, picker, viewModel)
                    }
                }
            }
            if (picker.mode == DirectoryMode.Multiple) {
                Text("已选择 ${picker.selectedPaths.size} 个目录", color = MaterialTheme.colorScheme.onSurfaceVariant)
                picker.selectedPaths.take(4).forEach { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = viewModel::closeDirectoryPicker, modifier = Modifier.weight(1f)) { Text("取消") }
                Button(onClick = viewModel::confirmDirectorySelection, modifier = Modifier.weight(1f), enabled = picker.listing != null) {
                    Text(if (picker.mode == DirectoryMode.Single) "选择当前目录" else "确认选择")
                }
            }
        }
    }
}

@Composable
private fun DirectoryEntryRow(entry: ServerDirectoryEntry, picker: DirectoryPickerState, viewModel: AppViewModel) {
    val selected = picker.selectedPaths.contains(entry.path)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Default.FolderOpen, contentDescription = null, tint = Color(0xFFD97706))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f).clickable(enabled = entry.readable) { viewModel.openDirectory(entry.path) }) {
            Text(entry.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(entry.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (picker.mode == DirectoryMode.Multiple) {
            IconButton(onClick = { viewModel.toggleDirectorySelection(entry.path) }, enabled = entry.readable) {
                Icon(if (selected) Icons.Default.Check else Icons.Default.Add, contentDescription = "选择")
            }
        } else {
            IconButton(onClick = { viewModel.openDirectory(entry.path) }, enabled = entry.readable) {
                Icon(Icons.Default.ArrowBack, contentDescription = "打开", modifier = Modifier)
            }
        }
    }
}

@Composable
private fun SheetContent(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp)
            .padding(bottom = 24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        content()
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun DirectoryValueField(
    label: String,
    value: String,
    buttonText: String,
    multiple: Boolean = false,
    required: Boolean = false,
    onPick: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontWeight = FontWeight.Medium)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surfaceVariant
        ) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    value.ifBlank {
                        when {
                            required -> "请选择服务端目录"
                            multiple -> "未选择目录"
                            else -> "留空时后端自动分配"
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
                Button(onClick = onPick) {
                    Icon(Icons.Default.FolderOpen, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text(buttonText)
                }
            }
        }
    }
}

@Composable
private fun SelectField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    modifier: Modifier = Modifier,
    emptyLabel: String = "请选择",
    onSelected: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val display = options.find { it.first == value }?.second ?: emptyLabel
    Box(modifier) {
        OutlinedTextField(
            value = display,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            label = { Text(label) },
            readOnly = true,
            enabled = options.isNotEmpty(),
            trailingIcon = { Icon(Icons.Default.MoreVert, contentDescription = null) }
        )
        Box(
            Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(4.dp))
                .clickable(enabled = options.isNotEmpty()) { expanded = true }
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { expanded = false; onSelected(id) })
            }
        }
    }
}

private fun csv(value: String): List<String> =
    value.split(',').map { it.trim() }.filter { it.isNotBlank() }.distinct()

private fun mergeCsv(current: String, next: List<String>): String =
    (csv(current) + next.map { it.trim() }.filter { it.isNotBlank() }).distinct().joinToString(", ")

private fun parseJsonObject(value: String): JsonObject? {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return null
    return runCatching { Json.decodeFromString(JsonObject.serializer(), trimmed) }.getOrNull()
}

private fun parseSkills(value: String): JsonElement? {
    val items = csv(value)
    if (items.isEmpty()) return null
    if (items.size == 1 && items.first() == "all") return JsonPrimitive("all")
    return buildJsonArray { items.forEach { add(JsonPrimitive(it)) } }
}
