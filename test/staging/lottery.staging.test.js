const { assert, expect } = require("chai")
const { ethers, network } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
    ? describe.skip
    : describe("lottery staging test", function () {
          let lottery, deployer, lotterEntranceFee

          beforeEach(async function () {
              const accounts = await ethers.getSigners()
              deployer = accounts[0]
              lottery = await ethers.getContract("Lottery", deployer)
              lotterEntranceFee = await lottery.getEntranceFee()
          })

          describe("fullfillRandomWords", function () {
              it("Works with live chainlink keepers and chainlink vrf, we get a random winner", async function () {
                  // enter the raffle
                  const startingTimeStamp = await lottery.getLatestTimeStamp()

                  // setup listener before we enter the lottery just in case the blockchain moves really fast

                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          console.log("Winner Picked, event fired!")
                          try {
                              // add our assert here
                              const recentWinner = await lottery.getRecentWinner()
                              const lotteryState = await lottery.getLotteryState()
                              const winnerEndingBalance = await deployer.getBalance()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()

                              await expect(lottery.getPlayer(0)).to.be.reverted
                              assert.equal(recentWinner.toString(), deployer.address)
                              assert.equal(lotteryState.toString(), "0")
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(lotterEntranceFee).toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve()
                          } catch (e) {
                              console.log(e)
                              reject(e)
                          }
                      })

                      // then entering the lottery
                      const tx = await lottery.enterLottery({ value: lotterEntranceFee })
                      await tx.wait(1)
                      console.log("Lottery entered!")
                      const winnerStartingBalance = await deployer.getBalance()

                      // and this code won't finish until our listener finish listening
                  })
              })
          })
      })

// await vrfCoordinatorV2Mock.addConsumer("1", lottery.address)

// await lottery.enterLottery({ value: paidEntry })
