const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("lottery unit test", function () {
          let lottery, vrfCoordinatorV2Mock, interval

          const chainId = network.config.chainId

          beforeEach(async function () {
              const { deployer } = await getNamedAccounts()
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              interval = await lottery.getInterval()
          })

          describe("Constructor", function () {
              it("Initializes the lottery state correctly", async function () {
                  const lotteryState = await lottery.getLotteryState()
                  assert.equal(lotteryState, "0")
              })

              it("Initializes the entrance fee correctly", async function () {
                  const entranceFee = await lottery.getEntranceFee()
                  assert.equal(entranceFee, networkConfig[chainId]["entranceFee"].toString())
              })

              it("Initializes the interval correctly", async function () {
                  assert.equal(interval, networkConfig[chainId]["interval"].toString())
              })
          })

          describe("enterLottery", function () {
              it("revert when you don't pay enough", async function () {
                  const paidEntry = (await lottery.getEntranceFee()) * 0.95
                  await expect(lottery.enterLottery({ value: paidEntry })).to.be.reverted
              })

              it("Records players when they enter", async function () {
                  const { deployer } = await getNamedAccounts()
                  const indexLastAddedPlayer = await lottery.getNumberOfPlayers()
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  const playerFromContract = await lottery.getPlayer(indexLastAddedPlayer)
                  assert.equal(playerFromContract, deployer)
              })

              it("emits event on enter", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  const { deployer } = await getNamedAccounts()
                  expect(await lottery.enterLottery({ value: paidEntry }))
                      .to.emit(lottery, "LotteryEntered")
                      .withArgs(deployer.address)
              })

              it("doesn't allow enter when lottery is calculating", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //   await network.provider.request({ method: "evm_mine", params: [] })
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  await lottery.performUpkeep([])
                  await expect(lottery.enterLottery({ value: paidEntry })).to.be.revertedWith(
                      "Lottery__NotOpen"
                  )
              })
          })

          describe("Check upKeep", function () {
              it("returns fals if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })

              it("returns false if lottery isn't open", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  await lottery.performUpkeep("0x")
                  const lotteryState = await lottery.getLotteryState()
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert.equal(lotteryState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("returns false if enough time hasn't passed", async () => {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })

              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkUpkeep is true", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  const tx = await lottery.performUpkeep("0x")
                  assert(tx)
              })

              it("reverts when checkUpkeep is false", async function () {
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  await expect(lottery.performUpkeep("0x")).to.be.revertedWith(
                      "Lottery__upKeepNotNeeded"
                  )
              })

              it("updates the lotteryState, emits an event and calls the vrf coordinator", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  const txResponse = await lottery.performUpkeep("0x")
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const lotteryState = await lottery.getLotteryState()
                  assert(requestId.toNumber() > 0)
                  assert(lotteryState == 1)
              })
          })

          describe("fullfillRandomWords", function () {
              beforeEach(async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await lottery.enterLottery({ value: paidEntry })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })

              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              it("picks a winner, reset the lottery, and sends money", async function () {
                  const paidEntry = await lottery.getEntranceFee()
                  await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)
                  const additionalEntrance = 3
                  const startingAccountIndex = 1 //deployer = 0

                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrance;
                      i++
                  ) {
                      const accountConnectedLottery = lottery.connect(accounts[i])
                      await accountConnectedLottery.enterLottery({ value: paidEntry })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()

                  // perform upkeap (Mock being chainlink keepers)
                  // fulfullRandomWords
                  // we have to wait for fulfillranromwords to be called

                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          console.log("Found the event!")
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              console.log(recentWinner)
                              console.log(accounts[2].address)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[3].address)
                              const lotteryState = await lottery.getLotteryState()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()
                              const numPlayers = await lottery.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      paidEntry.mul(additionalEntrance).add(paidEntry).toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const tx = await lottery.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })
