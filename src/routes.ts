import { FastifyInstance, FastifyRequest, DoneFuncWithErrOrRes } from "fastify";
import { users, messages } from ".";
import { MessageStructure, MessageProps, createMessage } from "./lib/database";
import { sendToAllClients, sendToClient } from "./lib/events";

type ConnectionRequest = FastifyRequest<{
  Querystring: { username: string }
}>

export function router(fastify: FastifyInstance, _: any, done: () => void) {
  // -----------------------------
  // LISTA DE USUÁRIOS CONECTADOS
  // -----------------------------

  fastify.get('/users', (_, reply) => {
    reply.status(200).send([...users])
  })

  // -----------------------------
  //    ESCOLHER NOME DE USUÁRIO
  // -----------------------------

  fastify.post<{ Body: { username: string } }>('/username', (request, reply) => {
    const { username } = request.body

    if (!username) {
      return reply.status(422).send({
        error: 'Um nome precisa ser fornecido.'
      })
    }

    if (users.has(username)) {
      return reply.status(409).send({
        error: 'Já existe um usuário online com esse nome.'
      })
    }

    reply.status(200).send({ ok: true })
  })

  // -----------------------------
  //        ENVIAR MENSAGEM
  // -----------------------------

  fastify.post('/message', (request, reply) => {
    const messageReceived = request.body as MessageStructure
    const message: MessageProps = {
      ...messageReceived,
      createdAt: Date.now()
    }

    if (messages.length >= 5) {
      messages.shift()
    }

    messages.push(message)

    const { id } = createMessage(messageReceived)

    sendToAllClients(fastify.websocketServer, { name: 'messageSent', message: { ...message, id }, removeOld: messages.length > 49 })

    reply.code(201).send({ ok: true })
  })

  // -----------------------------
  //    CONEXÃO COM O WEBSOCKET
  // -----------------------------

  fastify.get('/', { websocket: true }, (socket, request: ConnectionRequest) => {
    const { username } = request.query

    if (users.has(username)) {
      socket.close(4001, `Já existe um usuário com o nome ${username} conectado, escolha outro nome de usuário.`)
    } else {
      users.add(username)

      const newUsersCount = [...fastify.websocketServer.clients].filter(c => c.readyState === 1).length

      sendToAllClients(fastify.websocketServer, { name: 'userJoin', user: username, counter: newUsersCount })
      sendToClient(socket, { name: 'messagesList', messages })

      socket.on('close', () => {
        const newUsersCount = [...fastify.websocketServer.clients].filter(c => c.readyState === 1).length

        users.delete(username)
        sendToAllClients(fastify.websocketServer, { name: 'userLeft', user: username, counter: newUsersCount })
      })
    }
  })

  done()
}