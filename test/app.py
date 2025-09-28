# Это ЕДИНСТВЕННЫЙ способ полноценного поиска
from telethon import TelegramClient
import asyncio

api_id = '25870020'
api_hash = 'ee964ddb2a9179a447a9f20b10bc63c8'
phone = '89161166210'


async def safe_global_search(username):
    async with TelegramClient('session', api_id, api_hash) as client: # type: ignore
        try:
            user = await client.get_entity(username)
            return {
                    "id": user.id,
                    "username": user.username,
                    "first_name": user.first_name,
                    "last_name": user.last_name
                }
        except ValueError:
            return "Пользователь не найден"
        except Exception as e:
            return f"Ошибка: {e}"


# Поиск по username
result1 = asyncio.run(safe_global_search('gh0stkuro_exe'))
print(result1)