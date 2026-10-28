# Runbook: `rb-dr-backup-restore` — Аварийное восстановление (DR) и проверка бэкапов БД

## Триггер
- Ошибка целостности БД (`PRAGMA integrity_check != ok` / сбой диска PostgreSQL).
- Плановое тестирование DR-процедуры перед релизом (`10-checklist.md` → «План DR и бэкапов»).
- Случайное повреждение конфигурации или миграции.

## Симптомы
- Рост `500 Internal Server Error` на эндпоинтах записи (`/api/client/v1/*`, `/api/admin/*`).
- Срабатывание алерта `Critical` в Зоне `Ops` по недоступности хранилища.

## Пошаговая диагностика
1. Проверить статус здоровья и целостности в разделе **«Система и Чек-лист (DR)»** (`GET /api/admin/system/readiness`).
2. Проверить свободное место на диске и список горячих снимков в `newfolder/data/backups/`:
   ```bash
   df -h
   ls -lh newfolder/data/backups/
   ```
3. Проверить целостность последнего снимка БД:
   ```bash
   node --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('newfolder/data/crm.sqlite'); console.log(d.prepare('PRAGMA integrity_check').all());"
   ```

## Команды создания горячего бэкапа и отката (Restore)
1. **Включить режим техработ** в админке (`maintenance_mode = ON`), чтобы остановить старт новых матчей и отправить автоматический пуш игрокам.
2. **Создать горячий консистентный снимок** без остановки чтения (`POST /api/admin/system/backup` — внутри выполняет атомарный `VACUUM INTO`).
3. **Откат из проверенного снимка**:
   ```bash
   cp newfolder/data/backups/crm-backup-latest.sqlite newfolder/data/crm.sqlite
   ```
   *(Для продакшен PostgreSQL: `pg_restore --clean --if-exists -d topspin_crm backup.dump` с проверкой региональных схем `players`, `payments`, `ops`, `fraud`, `balance`, `market`, `lab`, `director`.)*
4. Перезапустить сервис, убедиться в прохождении `GET /api/health` и `GET /api/admin/system/readiness`, затем выключить `maintenance_mode`.

## Эскалация
- Ответственный: Владелец проекта / Дежурный инфраструктурный администратор (`owner@topspin.arena`).
